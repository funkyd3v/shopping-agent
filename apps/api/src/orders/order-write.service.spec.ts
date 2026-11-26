import { NotFoundException } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateEnv } from '../config/env';
import type { PrismaService } from '../db/prisma.service';
import type { GuardrailRecord, GuardrailService } from '../guardrails/guardrail.service';
import { CheckoutService } from './checkout.service';
import { OrderService } from './order.service';
import { OrderRefusalError, OrderWriteService } from './order-write.service';

type FakeProduct = { id: string; name: string; sku: string; priceCents: number; stock: number };

type FakeOrderItem = {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  sku: string;
  qty: number;
  unitPriceCents: number;
};

type FakeOrder = {
  id: string;
  orderNumber: string;
  userId: string;
  status: string;
  source: string;
  placedBy: string;
  totalCents: number;
  currency: string;
  idempotencyKey: string;
  cartId: string | null;
  addressSnapshotJson: string;
  turnId: string | null;
  clientMessageId: string | null;
  createdAt: Date;
  cancellableUntil: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  items: FakeOrderItem[];
};

type FakeItem = {
  id: string;
  cartId: string;
  productId: string;
  qty: number;
  priceAtAddCents: number;
  addedAt: Date;
};

type FakeCart = { id: string; userId: string; items: FakeItem[] };

const ADDRESS = {
  line1: '1 Market Street',
  line2: null,
  city: 'San Francisco',
  region: 'CA',
  postalCode: '94105',
  country: 'US',
};

class UniqueViolation extends Error {
  readonly code = 'P2002';
}

/** Minimal in-memory Prisma covering the order write path (no DB, no network). */
class FakePrisma {
  readonly products = new Map<string, FakeProduct>();
  readonly carts = new Map<string, FakeCart>();
  readonly orders = new Map<string, FakeOrder>();
  readonly addresses = new Map<string, typeof ADDRESS>();
  private seq = 0;

  addProduct(product: Partial<FakeProduct> & { id: string }): FakeProduct {
    const row: FakeProduct = {
      name: `Product ${product.id}`,
      sku: `SKU-${product.id}`,
      priceCents: 1000,
      stock: 10,
      ...product,
    };
    this.products.set(row.id, row);
    return row;
  }

  setAddress(userId: string, address: typeof ADDRESS | null = ADDRESS): void {
    if (address) this.addresses.set(userId, address);
    else this.addresses.delete(userId);
  }

  seedCart(userId: string, items: Array<{ productId: string; qty: number }>): FakeCart {
    const cart: FakeCart = { id: `cart_${userId}`, userId, items: [] };
    for (const item of items) {
      const product = this.products.get(item.productId);
      if (!product) throw new Error(`seedCart: missing product ${item.productId}`);
      cart.items.push({
        id: `item_${++this.seq}`,
        cartId: cart.id,
        productId: item.productId,
        qty: item.qty,
        priceAtAddCents: product.priceCents,
        addedAt: new Date(2026, 0, this.seq),
      });
    }
    this.carts.set(userId, cart);
    return cart;
  }

  /** Insert a historical order directly (daily-cap and window fixtures). */
  seedOrder(order: Partial<FakeOrder> & { id: string; userId: string }): FakeOrder {
    const row: FakeOrder = {
      orderNumber: `ORD-SEED${order.id.slice(-4)}`,
      status: 'placed',
      source: 'direct',
      placedBy: 'agent',
      totalCents: 1000,
      currency: 'USD',
      idempotencyKey: `seed-${order.id}`,
      cartId: null,
      addressSnapshotJson: JSON.stringify(ADDRESS),
      turnId: null,
      clientMessageId: null,
      createdAt: new Date(),
      cancellableUntil: new Date(Date.now() + 30 * 60_000),
      cancelledAt: null,
      cancelledBy: null,
      items: [],
      ...order,
    };
    this.orders.set(row.id, row);
    return row;
  }

  orderCount(): number {
    return this.orders.size;
  }

  private withItems(order: FakeOrder | null) {
    if (!order) return null;
    return { ...order, items: [...order.items].sort((a, b) => a.id.localeCompare(b.id)) };
  }

  private snapshot() {
    return {
      products: new Map([...this.products].map(([k, v]) => [k, { ...v }])),
      carts: new Map(
        [...this.carts].map(([k, v]) => [k, { ...v, items: v.items.map((i) => ({ ...i })) }]),
      ),
      orders: new Map(
        [...this.orders].map(([k, v]) => [k, { ...v, items: v.items.map((i) => ({ ...i })) }]),
      ),
    };
  }

  private restore(snap: ReturnType<FakePrisma['snapshot']>): void {
    this.products.clear();
    for (const [k, v] of snap.products) this.products.set(k, v);
    this.carts.clear();
    for (const [k, v] of snap.carts) this.carts.set(k, v);
    this.orders.clear();
    for (const [k, v] of snap.orders) this.orders.set(k, v);
  }

  readonly address = {
    findUnique: async ({ where }: { where: { userId: string } }) =>
      this.addresses.get(where.userId) ?? null,
  };

  readonly product = {
    findUnique: async ({ where }: { where: { id: string } }) => this.products.get(where.id) ?? null,
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; stock: { gte: number } };
      data: { stock: { decrement: number } };
    }) => {
      const product = this.products.get(where.id);
      if (!product || product.stock < where.stock.gte) return { count: 0 };
      product.stock -= data.stock.decrement;
      return { count: 1 };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { stock: { increment: number } };
    }) => {
      const product = this.products.get(where.id);
      if (!product) throw new Error('product.update: missing product');
      product.stock += data.stock.increment;
      return product;
    },
  };

  readonly cart = {
    findUnique: async ({ where }: { where: { userId: string } }) => {
      const cart = this.carts.get(where.userId);
      if (!cart) return null;
      return {
        id: cart.id,
        items: [...cart.items]
          .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())
          .map((item) => ({ ...item })),
      };
    },
  };

  readonly cartItem = {
    deleteMany: async ({ where }: { where: { cartId: string } }) => {
      const cart = [...this.carts.values()].find((row) => row.id === where.cartId);
      const count = cart?.items.length ?? 0;
      if (cart) cart.items = [];
      return { count };
    },
  };

  readonly order = {
    findUnique: async ({
      where,
    }: {
      where:
        | { userId_idempotencyKey: { userId: string; idempotencyKey: string } }
        | { orderNumber: string }
        | { id: string };
    }) => {
      if ('userId_idempotencyKey' in where) {
        const { userId, idempotencyKey } = where.userId_idempotencyKey;
        for (const order of this.orders.values()) {
          if (order.userId === userId && order.idempotencyKey === idempotencyKey) {
            return this.withItems(order);
          }
        }
        return null;
      }
      if ('orderNumber' in where) {
        for (const order of this.orders.values()) {
          if (order.orderNumber === where.orderNumber) return this.withItems(order);
        }
        return null;
      }
      return this.withItems(this.orders.get(where.id) ?? null);
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const order = this.orders.get(where.id);
      if (!order) throw new Error('order.findUniqueOrThrow: missing order');
      return this.withItems(order);
    },
    findFirst: async ({
      where,
    }: {
      where: { userId: string; OR: Array<Record<string, string>> };
    }) => {
      for (const clause of where.OR) {
        const key = Object.keys(clause)[0] as 'id' | 'orderNumber';
        const value = clause[key] as string;
        for (const order of this.orders.values()) {
          if (order.userId === where.userId && order[key] === value) return this.withItems(order);
        }
      }
      return null;
    },
    create: async ({
      data,
    }: {
      data: Record<string, unknown> & { items: { create: FakeOrderItem[] } };
    }) => {
      const turnId = (data.turnId as string | null) ?? null;
      for (const order of this.orders.values()) {
        if (order.userId === data.userId && order.idempotencyKey === data.idempotencyKey) {
          throw new UniqueViolation('unique(userId, idempotencyKey)');
        }
        if (turnId && order.userId === data.userId && order.turnId === turnId) {
          throw new UniqueViolation('unique(userId, turnId)');
        }
        if (order.orderNumber === data.orderNumber) {
          throw new UniqueViolation('unique(orderNumber)');
        }
      }
      const order: FakeOrder = {
        id: data.id as string,
        orderNumber: data.orderNumber as string,
        userId: data.userId as string,
        status: data.status as string,
        source: data.source as string,
        placedBy: data.placedBy as string,
        totalCents: data.totalCents as number,
        currency: data.currency as string,
        idempotencyKey: data.idempotencyKey as string,
        cartId: (data.cartId as string | null) ?? null,
        addressSnapshotJson: data.addressSnapshotJson as string,
        turnId,
        clientMessageId: (data.clientMessageId as string | null) ?? null,
        createdAt: new Date(),
        cancellableUntil: (data.cancellableUntil as Date | null) ?? null,
        cancelledAt: null,
        cancelledBy: null,
        items: data.items.create.map((item) => ({ ...item, orderId: data.id as string })),
      };
      this.orders.set(order.id, order);
      return this.withItems(order);
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; userId: string; status: string; cancellableUntil: { gt: Date } };
      data: { status: string; cancelledAt: Date; cancelledBy: string };
    }) => {
      const order = this.orders.get(where.id);
      const matches =
        !!order &&
        order.userId === where.userId &&
        order.status === where.status &&
        !!order.cancellableUntil &&
        order.cancellableUntil.getTime() > where.cancellableUntil.gt.getTime();
      if (!matches || !order) return { count: 0 };
      order.status = data.status;
      order.cancelledAt = data.cancelledAt;
      order.cancelledBy = data.cancelledBy;
      return { count: 1 };
    },
    count: async ({
      where,
    }: {
      where: { userId: string; placedBy: string; createdAt: { gte: Date } };
    }) =>
      [...this.orders.values()].filter(
        (order) =>
          order.userId === where.userId &&
          order.placedBy === where.placedBy &&
          order.createdAt.getTime() >= where.createdAt.gte.getTime(),
      ).length,
    aggregate: async ({
      where,
    }: {
      where: { userId: string; placedBy: string; createdAt: { gte: Date } };
    }) => {
      const rows = [...this.orders.values()].filter(
        (order) =>
          order.userId === where.userId &&
          order.placedBy === where.placedBy &&
          order.createdAt.getTime() >= where.createdAt.gte.getTime(),
      );
      return { _sum: { totalCents: rows.reduce((sum, row) => sum + row.totalCents, 0) } };
    },
  };

  readonly $transaction = async <T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> => {
    const snap = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snap);
      throw error;
    }
  };
}

class FakeGuardrails {
  readonly events: GuardrailRecord[] = [];

  async record(event: GuardrailRecord): Promise<void> {
    this.events.push(event);
  }
}

type Harness = {
  prisma: FakePrisma;
  guardrails: FakeGuardrails;
  write: OrderWriteService;
  checkout: CheckoutService;
  orders: OrderService;
};

function harness(): Harness {
  const prisma = new FakePrisma();
  const guardrails = new FakeGuardrails();
  const write = new OrderWriteService(
    prisma as unknown as PrismaService,
    guardrails as unknown as GuardrailService,
  );
  return {
    prisma,
    guardrails,
    write,
    checkout: new CheckoutService(write),
    orders: new OrderService(prisma as unknown as PrismaService, write),
  };
}

beforeAll(() => {
  validateEnv({ JWT_SECRET: 'x'.repeat(32), DATABASE_URL: 'file:test.db' });
});

const pageActor = (userId = 'user_01') => ({
  userId,
  placedBy: 'user' as const,
  sessionId: 'page',
});

const agentActor = (userId = 'user_01') => ({
  userId,
  placedBy: 'agent' as const,
  sessionId: 'ses_01',
  turnId: 'turn_01',
  clientMessageId: 'msg_01',
});

function readyHarness(): Harness {
  const h = harness();
  h.prisma.addProduct({ id: 'prod_01', priceCents: 2500, stock: 10 });
  h.prisma.setAddress('user_01');
  h.prisma.seedCart('user_01', [{ productId: 'prod_01', qty: 2 }]);
  return h;
}

describe('OrderWriteService.checkout', () => {
  it('places an order, decrements stock, clears the cart, and audits the write', async () => {
    const h = readyHarness();

    const order = await h.checkout.checkout(pageActor(), 'req-00000001');

    expect(order).toMatchObject({
      source: 'cart',
      placedBy: 'user',
      status: 'placed',
      totalCents: 5000,
      cartId: 'cart_user_01',
      itemCount: 1,
    });
    expect(order.items).toEqual([
      expect.objectContaining({ productId: 'prod_01', qty: 2, unitPriceCents: 2500 }),
    ]);
    expect(order.orderNumber).toMatch(/^ORD-[0-9A-Z]{6}$/);
    expect(h.prisma.products.get('prod_01')?.stock).toBe(8);
    expect(h.prisma.carts.get('user_01')?.items).toEqual([]);
    expect(h.guardrails.events).toEqual([
      expect.objectContaining({ rule: 'order.checkout', action: 'allow', sessionId: 'page' }),
    ]);
  });

  it('replays the original order for the same clientRequestId even after the cart empties', async () => {
    const h = readyHarness();

    const first = await h.checkout.checkout(pageActor(), 'req-00000001');
    const second = await h.checkout.checkout(pageActor(), 'req-00000001');

    expect(second.id).toBe(first.id);
    expect(h.prisma.orderCount()).toBe(1);
    expect(h.prisma.products.get('prod_01')?.stock).toBe(8);
    expect(h.guardrails.events.at(-1)).toMatchObject({ rule: 'order.idempotent', action: 'allow' });
  });

  it('refuses an over-limit cart without touching stock, cart, or order rows', async () => {
    const h = harness();
    h.prisma.addProduct({ id: 'prod_big', priceCents: 20_001, stock: 10 });
    h.prisma.setAddress('user_01');
    h.prisma.seedCart('user_01', [{ productId: 'prod_big', qty: 1 }]);

    await expect(h.checkout.checkout(pageActor(), 'req-00000002')).rejects.toMatchObject({
      refusal: { code: 'ORDER_LIMIT', limit: 20_000, actual: 20_001 },
    });

    expect(h.prisma.orderCount()).toBe(0);
    expect(h.prisma.products.get('prod_big')?.stock).toBe(10);
    expect(h.prisma.carts.get('user_01')?.items).toHaveLength(1);
    expect(h.guardrails.events).toEqual([
      expect.objectContaining({
        rule: 'order.refuse',
        action: 'refuse',
        details: expect.objectContaining({ code: 'ORDER_LIMIT' }),
      }),
    ]);
  });

  it('refuses an empty cart and a missing address before writing anything', async () => {
    const h = harness();
    h.prisma.addProduct({ id: 'prod_01' });

    await expect(h.checkout.checkout(pageActor(), 'req-00000003')).rejects.toMatchObject({
      refusal: { code: 'NO_ADDRESS' },
    });

    h.prisma.setAddress('user_01');
    await expect(h.checkout.checkout(pageActor(), 'req-00000004')).rejects.toMatchObject({
      refusal: { code: 'CART_EMPTY' },
    });

    expect(h.prisma.orderCount()).toBe(0);
    expect(h.guardrails.events.map((event) => event.rule)).toEqual([
      'order.refuse',
      'order.refuse',
    ]);
  });

  it('refuses a line whose stock is short and rolls the whole order back', async () => {
    const h = harness();
    h.prisma.addProduct({ id: 'prod_ok', priceCents: 100, stock: 10 });
    h.prisma.addProduct({ id: 'prod_short', priceCents: 100, stock: 1 });
    h.prisma.setAddress('user_01');
    h.prisma.seedCart('user_01', [
      { productId: 'prod_ok', qty: 2 },
      { productId: 'prod_short', qty: 3 },
    ]);

    await expect(h.checkout.checkout(pageActor(), 'req-00000005')).rejects.toMatchObject({
      refusal: { code: 'OUT_OF_STOCK', productId: 'prod_short' },
    });

    expect(h.prisma.products.get('prod_ok')?.stock).toBe(10);
    expect(h.prisma.products.get('prod_short')?.stock).toBe(1);
    expect(h.prisma.carts.get('user_01')?.items).toHaveLength(2);
    expect(h.prisma.orderCount()).toBe(0);
  });

  it('serializes concurrent checkouts so only one order consumes the cart', async () => {
    const h = readyHarness();

    const results = await Promise.allSettled([
      h.checkout.checkout(pageActor(), 'req-00000006'),
      h.checkout.checkout(pageActor(), 'req-00000007'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(h.prisma.orderCount()).toBe(1);
    expect(h.prisma.products.get('prod_01')?.stock).toBe(8);
  });
});

describe('OrderService.placeDirect', () => {
  it('places an order from explicit items and is idempotent per clientMessageId', async () => {
    const h = harness();
    h.prisma.addProduct({ id: 'prod_01', priceCents: 1500, stock: 5 });
    h.prisma.setAddress('user_01');

    const actor = agentActor();
    const first = await h.orders.placeDirect({
      actor,
      clientMessageId: 'msg_01',
      items: [{ productId: 'prod_01', qty: 2 }],
    });
    const second = await h.orders.placeDirect({
      actor,
      clientMessageId: 'msg_01',
      items: [{ productId: 'prod_01', qty: 2 }],
    });

    expect(first).toMatchObject({ source: 'direct', placedBy: 'agent', totalCents: 3000 });
    expect(second.id).toBe(first.id);
    expect(h.prisma.orderCount()).toBe(1);
    expect(h.prisma.products.get('prod_01')?.stock).toBe(3);
  });

  it('allows only one order per chat turn', async () => {
    const h = harness();
    h.prisma.addProduct({ id: 'prod_01', priceCents: 1500, stock: 5 });
    h.prisma.setAddress('user_01');

    await h.orders.placeDirect({
      actor: agentActor(),
      clientMessageId: 'msg_01',
      items: [{ productId: 'prod_01', qty: 1 }],
    });

    await expect(
      h.orders.placeDirect({
        actor: { ...agentActor(), turnId: 'turn_01' },
        clientMessageId: 'msg_02',
        items: [{ productId: 'prod_01', qty: 1 }],
      }),
    ).rejects.toMatchObject({ refusal: { code: 'ORDER_LIMIT', limit: 1 } });

    expect(h.prisma.orderCount()).toBe(1);
    expect(h.prisma.products.get('prod_01')?.stock).toBe(4);
  });

  it('enforces the daily agent order count', async () => {
    const h = harness();
    h.prisma.addProduct({ id: 'prod_01', priceCents: 100, stock: 50 });
    h.prisma.setAddress('user_01');
    for (let i = 0; i < 5; i += 1) {
      h.prisma.seedOrder({ id: `ord_${i}`, userId: 'user_01', placedBy: 'agent' });
    }

    await expect(
      h.orders.placeDirect({
        actor: agentActor(),
        clientMessageId: 'msg_09',
        items: [{ productId: 'prod_01', qty: 1 }],
      }),
    ).rejects.toMatchObject({ refusal: { code: 'ORDER_LIMIT', limit: 5, actual: 5 } });

    expect(h.prisma.orderCount()).toBe(5);
  });

  it('enforces the daily agent spend cap', async () => {
    const h = harness();
    h.prisma.addProduct({ id: 'prod_01', priceCents: 1100, stock: 50 });
    h.prisma.setAddress('user_01');
    h.prisma.seedOrder({
      id: 'ord_spend',
      userId: 'user_01',
      placedBy: 'agent',
      totalCents: 49_000,
    });

    await expect(
      h.orders.placeDirect({
        actor: agentActor(),
        clientMessageId: 'msg_10',
        items: [{ productId: 'prod_01', qty: 1 }],
      }),
    ).rejects.toMatchObject({
      refusal: { code: 'ORDER_LIMIT', limit: 50_000, actual: 50_100 },
    });

    expect(h.prisma.orderCount()).toBe(1);
  });

  it('quotes without writing and reports the refusal it would hit', async () => {
    const h = harness();
    h.prisma.addProduct({ id: 'prod_01', priceCents: 25_000, stock: 10 });

    const quote = await h.write.quote(agentActor(), [{ productId: 'prod_01', qty: 1 }], false);

    expect(quote.totalCents).toBe(25_000);
    expect(quote.refusal).toMatchObject({ code: 'ORDER_LIMIT', limit: 20_000 });
    expect(h.prisma.orderCount()).toBe(0);
    expect(h.guardrails.events).toEqual([]);
  });
});

describe('OrderWriteService.cancelOrder', () => {
  async function placed(): Promise<Harness & { orderId: string }> {
    const h = readyHarness();
    const order = await h.checkout.checkout(pageActor(), 'req-00000010');
    return { ...h, orderId: order.id };
  }

  it('cancels inside the window, restocks, and audits the write', async () => {
    const h = await placed();

    const cancelled = await h.write.cancelOrder({ actor: pageActor(), reference: h.orderId });

    expect(cancelled).toMatchObject({ status: 'cancelled', cancelledBy: 'user' });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(h.prisma.products.get('prod_01')?.stock).toBe(10);
    expect(h.guardrails.events.at(-1)).toMatchObject({ rule: 'order.cancel', action: 'allow' });
  });

  it('is idempotent: cancelling again returns the current state', async () => {
    const h = await placed();
    const first = await h.write.cancelOrder({ actor: pageActor(), reference: h.orderId });
    const second = await h.write.cancelOrder({ actor: pageActor(), reference: h.orderId });

    expect(second.status).toBe('cancelled');
    expect(second.cancelledAt).toBe(first.cancelledAt);
    // Restock happens exactly once.
    expect(h.prisma.products.get('prod_01')?.stock).toBe(10);
  });

  it('returns 404 for another user’s order', async () => {
    const h = await placed();

    await expect(
      h.write.cancelOrder({ actor: pageActor('user_02'), reference: h.orderId }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.prisma.orders.get(h.orderId)?.status).toBe('placed');
  });

  it('refuses cancellation once the window has passed', async () => {
    const h = await placed();
    const order = h.prisma.orders.get(h.orderId);
    if (!order) throw new Error('missing order');
    order.cancellableUntil = new Date(Date.now() - 1000);

    await expect(
      h.write.cancelOrder({ actor: pageActor(), reference: h.orderId }),
    ).rejects.toMatchObject({ refusal: { code: 'CANCEL_WINDOW_CLOSED' } });

    expect(h.prisma.orders.get(h.orderId)?.status).toBe('placed');
    expect(h.prisma.products.get('prod_01')?.stock).toBe(8);
    expect(h.guardrails.events.at(-1)).toMatchObject({ rule: 'order.refuse', action: 'refuse' });
  });

  it('refuses cancellation of a non-placed order', async () => {
    const h = await placed();
    const order = h.prisma.orders.get(h.orderId);
    if (!order) throw new Error('missing order');
    order.status = 'shipped';

    await expect(
      h.write.cancelOrder({ actor: pageActor(), reference: h.orderId }),
    ).rejects.toMatchObject({ refusal: { code: 'CANCEL_WINDOW_CLOSED' } });
  });
});

describe('OrderRefusalError', () => {
  it('carries the structured refusal fields', () => {
    const error = new OrderRefusalError({
      code: 'ORDER_LIMIT',
      message: 'over',
      limit: 20_000,
      actual: 25_000,
      allowed: 20_000,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.refusal).toMatchObject({ limit: 20_000, actual: 25_000, allowed: 20_000 });
  });
});
