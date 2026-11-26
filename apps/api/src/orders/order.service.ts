import { Injectable, NotFoundException } from '@nestjs/common';
import type { OrderDetail, OrderList, OrderListQuery } from '@shopping-agent/shared';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { decodeOrderCursor, encodeOrderCursor } from './order.cursor';
import { toOrderDetail, toOrderSummary } from './order.mapper';
import type { OrderActor, OrderLineInput, OrderWriteService } from './order-write.service';

/**
 * Order reads (REST + agent tools) plus direct placement and cancellation.
 * Every query is scoped by user id; all writes delegate to `OrderWriteService`.
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly write: OrderWriteService,
  ) {}

  /**
   * Place an order from explicit items (agent `place_order`). The idempotency
   * key is derived from the caller's `clientMessageId`, never from the model.
   */
  placeDirect(input: {
    actor: OrderActor;
    clientMessageId: string;
    items: OrderLineInput[];
  }): Promise<OrderDetail> {
    return this.write.placeOrder({
      actor: input.actor,
      source: 'direct',
      idempotencyKey: `direct:${input.clientMessageId}`,
      loadLines: async () => ({ cartId: null, items: input.items }),
    });
  }

  /** Cancel a placed order inside its window; identity comes from `actor`. */
  cancel(actor: OrderActor, reference: string): Promise<OrderDetail> {
    return this.write.cancelOrder({ actor, reference });
  }

  async listForUser(userId: string, query: OrderListQuery): Promise<OrderList> {
    const where: Prisma.OrderWhereInput = { userId };
    if (query.status) where.status = query.status;

    if (query.cursor) {
      const cursor = decodeOrderCursor(query.cursor);
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { _count: { select: { items: true } } },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((order) => toOrderSummary(order, { itemCount: order._count.items })),
      nextCursor: hasMore && last ? encodeOrderCursor(last) : null,
    };
  }

  async getForUser(userId: string, orderId: string): Promise<OrderDetail> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!order) {
      // Another user's order is indistinguishable from a missing order (PLAN §9.6).
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order not found.' });
    }
    return toOrderDetail(order);
  }

  /**
   * Agent tool lookup by internal id or customer-facing order number
   * (`ORD-…`). Still scoped by user, so another user's order is a 404.
   */
  async getByReferenceForUser(userId: string, reference: string): Promise<OrderDetail> {
    const ref = reference.trim();
    const order = await this.prisma.order.findFirst({
      where: {
        userId,
        OR: [{ id: ref }, { orderNumber: ref }, { orderNumber: ref.toUpperCase() }],
      },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!order) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order not found.' });
    }
    return toOrderDetail(order);
  }
}
