import { describe, expect, it } from 'vitest';
import type { Order, OrderItem } from '../generated/prisma/client';
import { type OrderWithItems, toOrderDetail, toOrderSummary } from './order.mapper';

const baseOrder = {
  id: 'ord_01',
  orderNumber: 'ORD-ABC12',
  userId: 'user_01',
  status: 'placed',
  source: 'direct',
  placedBy: 'user',
  totalCents: 1998,
  currency: 'USD',
  idempotencyKey: 'key-1',
  cartId: null,
  addressSnapshotJson: JSON.stringify({
    line1: '1 Market Street',
    line2: null,
    city: 'San Francisco',
    region: 'CA',
    postalCode: '94105',
    country: 'US',
  }),
  turnId: null,
  clientMessageId: null,
  createdAt: new Date('2026-11-25T10:00:00.000Z'),
  cancellableUntil: new Date('2026-11-25T10:30:00.000Z'),
  cancelledAt: null,
  cancelledBy: null,
} as Order;

const item = {
  id: 'oi_01',
  orderId: 'ord_01',
  productId: 'prod_01',
  productName: 'Aurora Wireless Headphones',
  sku: 'AUD-001-01',
  qty: 2,
  unitPriceCents: 999,
} as OrderItem;

describe('order mapper', () => {
  it('maps a summary and computes cancellability against the supplied clock', () => {
    expect(toOrderSummary(baseOrder, new Date('2026-11-25T10:15:00.000Z').getTime())).toEqual({
      id: 'ord_01',
      orderNumber: 'ORD-ABC12',
      status: 'placed',
      source: 'direct',
      placedBy: 'user',
      totalCents: 1998,
      currency: 'USD',
      createdAt: '2026-11-25T10:00:00.000Z',
      cancellableUntil: '2026-11-25T10:30:00.000Z',
      cancellable: true,
      cancelledAt: null,
    });

    expect(
      toOrderSummary(baseOrder, new Date('2026-11-25T10:31:00.000Z').getTime()).cancellable,
    ).toBe(false);
  });

  it('maps a detail with item snapshots and the address snapshot', () => {
    const order: OrderWithItems = { ...baseOrder, items: [item] };
    const detail = toOrderDetail(order);
    expect(detail.items).toEqual([
      {
        id: 'oi_01',
        productId: 'prod_01',
        productName: 'Aurora Wireless Headphones',
        sku: 'AUD-001-01',
        qty: 2,
        unitPriceCents: 999,
      },
    ]);
    expect(detail.address.city).toBe('San Francisco');
    expect(detail.cartId).toBeNull();
    expect(detail.cancelledBy).toBeNull();
  });

  it('maps cancellation metadata', () => {
    const order = {
      ...baseOrder,
      status: 'cancelled',
      cancellableUntil: null,
      cancelledAt: new Date('2026-11-25T10:10:00.000Z'),
      cancelledBy: 'agent',
      items: [],
    } as OrderWithItems;
    const detail = toOrderDetail(order);
    expect(detail.status).toBe('cancelled');
    expect(detail.cancelledAt).toBe('2026-11-25T10:10:00.000Z');
    expect(detail.cancelledBy).toBe('agent');
    expect(detail.cancellable).toBe(false);
  });
});
