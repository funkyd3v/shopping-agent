import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../db/prisma.service';
import type { Order } from '../generated/prisma/client';
import { decodeOrderCursor } from './order.cursor';
import type { OrderWithItems } from './order.mapper';
import { OrderService } from './order.service';

const order = (id: string, createdAt: string, status = 'placed'): Order =>
  ({
    id,
    orderNumber: `ORD-${id}`,
    userId: 'user_01',
    status,
    source: 'direct',
    placedBy: 'user',
    totalCents: 1000,
    currency: 'USD',
    idempotencyKey: `key-${id}`,
    cartId: null,
    addressSnapshotJson: JSON.stringify({
      line1: '1 Market Street',
      city: 'San Francisco',
      postalCode: '94105',
      country: 'US',
    }),
    turnId: null,
    clientMessageId: null,
    createdAt: new Date(createdAt),
    cancellableUntil: null,
    cancelledAt: null,
    cancelledBy: null,
  }) as Order;

class FakePrisma {
  listArgs: unknown;
  listRows: Order[] = [];
  getArgs: unknown;
  getRow: OrderWithItems | null = null;

  readonly order = {
    findMany: async (args: unknown): Promise<Order[]> => {
      this.listArgs = args;
      return this.listRows;
    },
    findFirst: async (args: unknown): Promise<OrderWithItems | null> => {
      this.getArgs = args;
      return this.getRow;
    },
  };
}

function serviceWith(prisma: FakePrisma): OrderService {
  return new OrderService(prisma as unknown as PrismaService);
}

describe('OrderService', () => {
  it('returns a page plus a keyset cursor and scopes every query to the user', async () => {
    const prisma = new FakePrisma();
    prisma.listRows = [
      order('ord_03', '2026-11-25T12:00:00.000Z'),
      order('ord_02', '2026-11-25T11:00:00.000Z'),
      order('ord_01', '2026-11-25T10:00:00.000Z'),
    ];
    const result = await serviceWith(prisma).listForUser('user_01', { limit: 2 });
    expect(result.items.map((row) => row.id)).toEqual(['ord_03', 'ord_02']);
    expect(result.nextCursor).not.toBeNull();
    expect(decodeOrderCursor(result.nextCursor ?? '')).toEqual({
      createdAt: new Date('2026-11-25T11:00:00.000Z'),
      id: 'ord_02',
    });
    expect(prisma.listArgs).toMatchObject({
      where: { userId: 'user_01' },
      take: 3,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('applies status and cursor filters', async () => {
    const prisma = new FakePrisma();
    prisma.listRows = [];
    await serviceWith(prisma).listForUser('user_01', {
      status: 'cancelled',
      limit: 20,
      cursor: Buffer.from('2026-11-25T10:00:00.000Z|ord_09', 'utf8').toString('base64url'),
    });
    expect(prisma.listArgs).toMatchObject({
      where: {
        userId: 'user_01',
        status: 'cancelled',
        OR: [
          { createdAt: { lt: new Date('2026-11-25T10:00:00.000Z') } },
          { createdAt: new Date('2026-11-25T10:00:00.000Z'), id: { lt: 'ord_09' } },
        ],
      },
    });
  });

  it('returns another user’s order as 404, never as a forbidden resource', async () => {
    const prisma = new FakePrisma();
    prisma.getRow = null;
    await expect(serviceWith(prisma).getForUser('user_01', 'ord_other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.getArgs).toMatchObject({
      where: { id: 'ord_other', userId: 'user_01' },
    });
  });

  it('returns order detail with item snapshots', async () => {
    const prisma = new FakePrisma();
    prisma.getRow = {
      ...order('ord_01', '2026-11-25T10:00:00.000Z'),
      items: [
        {
          id: 'oi_01',
          orderId: 'ord_01',
          productId: 'prod_01',
          productName: 'Aurora Wireless Headphones',
          sku: 'AUD-001-01',
          qty: 1,
          unitPriceCents: 1000,
        },
      ],
    };
    const detail = await serviceWith(prisma).getForUser('user_01', 'ord_01');
    expect(detail.items).toHaveLength(1);
    expect(detail.orderNumber).toBe('ORD-ord_01');
  });
});
