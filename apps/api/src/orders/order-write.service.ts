import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OrderDetail } from '@shopping-agent/shared';
import { ulid } from 'ulid';
import { WriteMutex } from '../common/write-mutex';
import { PrismaService } from '../db/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { GuardrailService } from '../guardrails/guardrail.service';
import { toOrderDetail } from './order.mapper';
import {
  cancellableUntil,
  type DailyAgentUsage,
  evaluateOrder,
  type OrderLimits,
  type OrderRefusal,
  orderLimits,
  type PricedLine,
  utcMidnight,
} from './order-limits';

/** Who is acting; identity always comes from the request context (PLAN §18). */
export type OrderActor = {
  userId: string;
  placedBy: 'user' | 'agent';
  /** Chat session id, or the synthetic `page` value for REST calls. */
  sessionId: string;
  turnId?: string | null;
  clientMessageId?: string | null;
};

export type OrderLineInput = { productId: string; qty: number };

export type PlaceOrderInput = {
  actor: OrderActor;
  source: 'direct' | 'cart';
  /** Server-derived `(userId, kind, client id)` key, checked before the cart. */
  idempotencyKey: string;
  /** Resolved inside the transaction so the cart is read and written atomically. */
  loadLines: (
    tx: Prisma.TransactionClient,
  ) => Promise<{ cartId: string | null; items: OrderLineInput[] }>;
};

export type CancelOrderInput = { actor: OrderActor; reference: string };

type OrderRow = Prisma.OrderGetPayload<{ include: { items: true } }>;

/** `sessionId` for `guardrail_events` when the action came from a page (PLAN §9.8). */
export const PAGE_SESSION_ID = 'page';

/**
 * Single write path for orders (PLAN §9.3–§9.6): process-wide mutex →
 * idempotency read → one interactive transaction (repricing, limits, stock,
 * snapshots) → commit → audit. No model call ever happens here.
 */
@Injectable()
export class OrderWriteService {
  private readonly logger = new Logger(OrderWriteService.name);
  private readonly mutex = new WriteMutex();

  constructor(
    private readonly prisma: PrismaService,
    private readonly guardrails: GuardrailService,
  ) {}

  async placeOrder(input: PlaceOrderInput): Promise<OrderDetail> {
    const { actor } = input;
    const limits = orderLimits();

    return this.mutex.run(async () => {
      const existing = await this.prisma.order.findUnique({
        where: {
          userId_idempotencyKey: { userId: actor.userId, idempotencyKey: input.idempotencyKey },
        },
        include: { items: { orderBy: { id: 'asc' } } },
      });
      if (existing) {
        // A retry returns the original order even when the cart is now empty.
        await this.record(actor, 'order.idempotent', 'allow', {
          source: input.source,
          orderNumber: existing.orderNumber,
        });
        return toOrderDetail(existing);
      }

      let order: OrderRow;
      try {
        const address = await this.loadAddress(actor.userId);
        if (!address) {
          throw refusal({
            code: 'NO_ADDRESS',
            message: 'Add a shipping address to your account before placing an order.',
          });
        }

        order = await this.prisma.$transaction(async (tx) => {
          const { cartId, items } = await input.loadLines(tx);
          const lines = await this.reprice(tx, items);
          const daily =
            actor.placedBy === 'agent' ? await this.dailyUsage(tx, actor.userId) : EMPTY_USAGE;
          const denied = evaluateOrder(lines, limits, daily);
          if (denied) throw refusal(denied);

          const now = new Date();
          const totalCents = lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0);
          const id = ulid();
          const created = await tx.order.create({
            data: {
              id,
              orderNumber: await this.nextOrderNumber(tx),
              userId: actor.userId,
              status: 'placed',
              source: input.source,
              placedBy: actor.placedBy,
              totalCents,
              currency: 'USD',
              idempotencyKey: input.idempotencyKey,
              cartId,
              addressSnapshotJson: JSON.stringify(address),
              turnId: actor.turnId ?? null,
              clientMessageId: actor.clientMessageId ?? null,
              cancellableUntil: cancellableUntil(now, limits),
              items: {
                create: lines.map((line) => ({
                  id: ulid(),
                  productId: line.productId,
                  productName: line.name,
                  sku: line.sku,
                  qty: line.qty,
                  unitPriceCents: line.unitPriceCents,
                })),
              },
            },
            include: { items: { orderBy: { id: 'asc' } } },
          });

          // All-or-nothing stock: any zero count aborts the transaction.
          for (const line of lines) {
            const decremented = await tx.product.updateMany({
              where: { id: line.productId, stock: { gte: line.qty } },
              data: { stock: { decrement: line.qty } },
            });
            if (decremented.count === 0) {
              throw refusal({
                code: 'OUT_OF_STOCK',
                message: `Only ${line.stock} of ${line.name} ${
                  line.stock === 1 ? 'is' : 'are'
                } available.`,
                productId: line.productId,
                actual: line.stock,
                allowed: line.stock,
              });
            }
          }

          if (cartId) await tx.cartItem.deleteMany({ where: { cartId } });
          return created;
        });
      } catch (error) {
        if (error instanceof OrderRefusalError) {
          await this.record(actor, 'order.refuse', 'refuse', {
            source: input.source,
            code: error.refusal.code,
            ...(error.refusal.limit !== undefined ? { limit: error.refusal.limit } : {}),
            ...(error.refusal.actual !== undefined ? { actual: error.refusal.actual } : {}),
          });
          this.logWrite('refused', actor, input.source, error.refusal.code);
          throw error;
        }
        if (isUniqueViolation(error)) {
          // `unique(user_id, turn_id)` enforces one order per chat turn (§9.4).
          // The idempotency key already matched above, so this is a second order.
          if (actor.turnId) {
            const denied: OrderRefusal = {
              code: 'ORDER_LIMIT',
              message:
                'Only one order can be placed per chat turn. Send a new message to place another order.',
              limit: 1,
              actual: 1,
              allowed: 1,
            };
            await this.record(actor, 'order.refuse', 'refuse', {
              source: input.source,
              code: denied.code,
            });
            this.logWrite('refused', actor, input.source, denied.code);
            throw refusal(denied);
          }
          // Defensive: lost a race on `unique(user_id, idempotency_key)`.
          const raced = await this.prisma.order.findUnique({
            where: {
              userId_idempotencyKey: {
                userId: actor.userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
            include: { items: { orderBy: { id: 'asc' } } },
          });
          if (raced) return toOrderDetail(raced);
        }
        this.logWrite('refused', actor, input.source, refusalCode(error));
        throw error;
      }

      await this.record(
        actor,
        input.source === 'cart' ? 'order.checkout' : 'order.place',
        'allow',
        {
          source: input.source,
          orderNumber: order.orderNumber,
          totalCents: order.totalCents,
          itemCount: order.items.length,
        },
      );
      this.logger.log(
        `order placed order=${order.orderNumber} source=${input.source} placedBy=${actor.placedBy} total=${order.totalCents} items=${order.items.length}`,
      );
      return toOrderDetail(order);
    });
  }

  async cancelOrder(input: CancelOrderInput): Promise<OrderDetail> {
    const { actor } = input;
    const reference = input.reference.trim();

    return this.mutex.run(async () => {
      const existing = await this.findOwned(actor.userId, reference);
      if (!existing) {
        // Another user's order is indistinguishable from a missing one (§9.6).
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order not found.' });
      }
      if (existing.status === 'cancelled') {
        // Idempotent: cancelling again returns the current state (200).
        return toOrderDetail(existing);
      }

      const now = new Date();
      const denied = cancelRefusal(existing, now, orderLimits());
      if (denied) {
        await this.record(actor, 'order.refuse', 'refuse', {
          code: denied.code,
          orderNumber: existing.orderNumber,
          status: existing.status,
        });
        this.logWrite('cancel refused', actor, existing.source, denied.code);
        throw refusal(denied);
      }

      let order: OrderRow;
      try {
        order = await this.prisma.$transaction(async (tx) => {
          const updated = await tx.order.updateMany({
            where: {
              id: existing.id,
              userId: actor.userId,
              status: 'placed',
              cancellableUntil: { gt: now },
            },
            data: { status: 'cancelled', cancelledAt: now, cancelledBy: actor.placedBy },
          });
          if (updated.count === 0) throw refusal(cancelRaceRefusal(existing, now));

          for (const item of existing.items) {
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { increment: item.qty } },
            });
          }
          return await tx.order.findUniqueOrThrow({
            where: { id: existing.id },
            include: { items: { orderBy: { id: 'asc' } } },
          });
        });
      } catch (error) {
        if (error instanceof OrderRefusalError) {
          await this.record(actor, 'order.refuse', 'refuse', {
            code: error.refusal.code,
            orderNumber: existing.orderNumber,
          });
          this.logWrite('cancel refused', actor, existing.source, error.refusal.code);
        }
        throw error;
      }
      await this.record(actor, 'order.cancel', 'allow', {
        orderNumber: order.orderNumber,
        totalCents: order.totalCents,
        restocked: order.items.length,
      });
      this.logger.log(
        `order cancelled order=${order.orderNumber} placedBy=${actor.placedBy} restocked=${order.items.length}`,
      );
      return toOrderDetail(order);
    });
  }

  /** Read-only price/stock check shared by the `quote_order` tool (PLAN §8.4). */
  async quote(actor: OrderActor, items: OrderLineInput[], fromCart: boolean) {
    const limits = orderLimits();
    const lines = fromCart
      ? await this.cartLines(actor.userId)
      : await this.reprice(this.prisma, items);
    const daily =
      actor.placedBy === 'agent' ? await this.dailyUsage(this.prisma, actor.userId) : EMPTY_USAGE;
    const totalCents = lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0);
    return {
      lines: lines.map((line) => ({ ...line, lineTotalCents: line.qty * line.unitPriceCents })),
      totalCents,
      daily,
      refusal: evaluateOrder(lines, limits, daily),
      limits,
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async loadAddress(userId: string) {
    const address = await this.prisma.address.findUnique({ where: { userId } });
    if (!address) return null;
    return {
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      country: address.country,
    };
  }

  private async findOwned(userId: string, reference: string): Promise<OrderRow | null> {
    return this.prisma.order.findFirst({
      where: {
        userId,
        OR: [
          { id: reference },
          { orderNumber: reference },
          { orderNumber: reference.toUpperCase() },
        ],
      },
      include: { items: { orderBy: { id: 'asc' } } },
    });
  }

  /** Reprice every line from `products`; a missing product is a 404. */
  private async reprice(
    db: Prisma.TransactionClient | PrismaService,
    items: OrderLineInput[],
  ): Promise<PricedLine[]> {
    const lines: PricedLine[] = [];
    for (const item of items) {
      const product = await db.product.findUnique({ where: { id: item.productId } });
      if (!product) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found.' });
      }
      lines.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        qty: item.qty,
        unitPriceCents: product.priceCents,
        stock: product.stock,
      });
    }
    return lines;
  }

  private async cartLines(userId: string): Promise<PricedLine[]> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true }, orderBy: { addedAt: 'asc' } } },
    });
    return (cart?.items ?? []).map((item) => ({
      productId: item.productId,
      name: item.product.name,
      sku: item.product.sku,
      qty: item.qty,
      unitPriceCents: item.product.priceCents,
      stock: item.product.stock,
    }));
  }

  private async dailyUsage(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
  ): Promise<DailyAgentUsage> {
    const since = utcMidnight();
    const [count, aggregate] = await Promise.all([
      db.order.count({ where: { userId, placedBy: 'agent', createdAt: { gte: since } } }),
      db.order.aggregate({
        where: { userId, placedBy: 'agent', createdAt: { gte: since } },
        _sum: { totalCents: true },
      }),
    ]);
    return { count, spendCents: aggregate._sum.totalCents ?? 0 };
  }

  /**
   * Unique customer-facing order number. All order writes hold the mutex, so a
   * read-then-write check is race-free on the single-instance deployment.
   */
  private async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `ORD-${randomOrderCode()}`;
      const clash = await tx.order.findUnique({ where: { orderNumber: candidate } });
      if (!clash) return candidate;
    }
    throw new BadRequestException({
      code: 'INTERNAL_ERROR',
      message: 'Could not allocate an order number. Please try again.',
    });
  }

  private async record(
    actor: OrderActor,
    rule: string,
    action: 'allow' | 'refuse',
    details: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await this.guardrails.record({
      userId: actor.userId,
      sessionId: actor.sessionId,
      rule,
      action,
      details: { placedBy: actor.placedBy, ...details },
    });
  }

  private logWrite(outcome: string, actor: OrderActor, source: string, code: string): void {
    this.logger.warn(`order ${outcome} source=${source} placedBy=${actor.placedBy} code=${code}`);
  }
}

const EMPTY_USAGE: DailyAgentUsage = { count: 0, spendCents: 0 };

/** Thrown so the transaction rolls back and the audit can read the refusal. */
export class OrderRefusalError extends Error {
  readonly refusal: OrderRefusal;

  constructor(refusal: OrderRefusal) {
    super(refusal.message);
    this.name = 'OrderRefusalError';
    this.refusal = refusal;
  }
}

function refusal(orderRefusal: OrderRefusal): OrderRefusalError {
  return new OrderRefusalError(orderRefusal);
}

function refusalCode(error: unknown): string {
  return error instanceof OrderRefusalError ? error.refusal.code : 'ERROR';
}

/** Prisma unique-constraint violation (`P2002`) without importing the runtime class. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Public REST shape: 400 with the shared error code and readable message. */
export function toHttpException(error: OrderRefusalError): BadRequestException {
  const { refusal: r } = error;
  return new BadRequestException({
    code: r.code,
    message: r.message,
    ...(r.limit !== undefined ? { limit: r.limit } : {}),
    ...(r.actual !== undefined ? { actual: r.actual } : {}),
    ...(r.allowed !== undefined ? { allowed: r.allowed } : {}),
  });
}

function cancelRefusal(order: OrderRow, now: Date, limits: OrderLimits): OrderRefusal | null {
  if (order.status !== 'placed') {
    return {
      code: 'CANCEL_WINDOW_CLOSED',
      message: `This order is ${order.status} and can no longer be cancelled.`,
    };
  }
  if (!order.cancellableUntil || order.cancellableUntil.getTime() <= now.getTime()) {
    const minutes = limits.cancelWindowMinutes;
    return {
      code: 'CANCEL_WINDOW_CLOSED',
      message: `The ${minutes}-minute cancellation window for this order has passed.`,
      limit: minutes * 60_000,
      actual: 0,
      allowed: 0,
    };
  }
  return null;
}

function cancelRaceRefusal(order: OrderRow, now: Date): OrderRefusal {
  return (
    cancelRefusal(order, now, orderLimits()) ?? {
      code: 'CANCEL_WINDOW_CLOSED',
      message: 'This order can no longer be cancelled.',
    }
  );
}

const ORDER_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomOrderCode(): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += ORDER_CODE_ALPHABET[Math.floor(Math.random() * ORDER_CODE_ALPHABET.length)];
  }
  return out;
}
