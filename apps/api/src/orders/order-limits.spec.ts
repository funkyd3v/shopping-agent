import { describe, expect, it } from 'vitest';
import {
  cancellableUntil,
  evaluateOrder,
  type OrderLimits,
  type PricedLine,
  utcMidnight,
} from './order-limits';

const limits: OrderLimits = {
  maxOrderCents: 20_000,
  maxQtyPerItem: 5,
  maxOrdersPerDay: 5,
  maxSpendPerDayCents: 50_000,
  cancelWindowMinutes: 30,
};

const noUsage = { count: 0, spendCents: 0 };

function line(overrides: Partial<PricedLine> = {}): PricedLine {
  return {
    productId: 'prod_01',
    name: 'Headphones',
    sku: 'SKU-01',
    qty: 1,
    unitPriceCents: 1000,
    stock: 10,
    ...overrides,
  };
}

describe('evaluateOrder', () => {
  it('refuses an empty cart', () => {
    expect(evaluateOrder([], limits, noUsage)).toMatchObject({ code: 'CART_EMPTY' });
  });

  it('allows totals at and just below the per-order limit, refuses above', () => {
    expect(evaluateOrder([line({ qty: 1, unitPriceCents: 19_999 })], limits, noUsage)).toBeNull();
    expect(evaluateOrder([line({ qty: 1, unitPriceCents: 20_000 })], limits, noUsage)).toBeNull();

    const over = evaluateOrder([line({ qty: 1, unitPriceCents: 20_001 })], limits, noUsage);
    expect(over).toMatchObject({
      code: 'ORDER_LIMIT',
      limit: 20_000,
      actual: 20_001,
      allowed: 20_000,
    });
  });

  it('allows a quantity at the per-item limit and refuses one above', () => {
    expect(evaluateOrder([line({ qty: 5 })], limits, noUsage)).toBeNull();

    const over = evaluateOrder([line({ qty: 6 })], limits, noUsage);
    expect(over).toMatchObject({
      code: 'ORDER_LIMIT',
      limit: 5,
      actual: 6,
      allowed: 5,
      productId: 'prod_01',
    });
  });

  it('refuses when the daily agent order count is already at the cap', () => {
    expect(evaluateOrder([line()], limits, { count: 4, spendCents: 0 })).toBeNull();

    const atCap = evaluateOrder([line()], limits, { count: 5, spendCents: 0 });
    expect(atCap).toMatchObject({ code: 'ORDER_LIMIT', limit: 5, actual: 5, allowed: 5 });
  });

  it('refuses when the daily agent spend would pass the cap', () => {
    expect(
      evaluateOrder([line({ unitPriceCents: 1000 })], limits, { count: 1, spendCents: 49_000 }),
    ).toBeNull();

    const over = evaluateOrder([line({ unitPriceCents: 1001 })], limits, {
      count: 1,
      spendCents: 49_000,
    });
    expect(over).toMatchObject({
      code: 'ORDER_LIMIT',
      limit: 50_000,
      actual: 50_001,
      allowed: 50_000,
    });
  });

  it('refuses a line whose stock is below the requested quantity', () => {
    expect(evaluateOrder([line({ qty: 2, stock: 2 })], limits, noUsage)).toBeNull();

    const short = evaluateOrder([line({ qty: 3, stock: 2 })], limits, noUsage);
    expect(short).toMatchObject({
      code: 'OUT_OF_STOCK',
      limit: 3,
      actual: 2,
      allowed: 2,
      productId: 'prod_01',
    });

    expect(evaluateOrder([line({ qty: 1, stock: 0 })], limits, noUsage)).toMatchObject({
      code: 'OUT_OF_STOCK',
      actual: 0,
    });
  });

  it('checks limits in policy order: total, then quantity, then daily caps, then stock', () => {
    // Over the total *and* over qty: the total wins.
    expect(
      evaluateOrder([line({ qty: 6, unitPriceCents: 20_001 })], limits, {
        count: 9,
        spendCents: 9,
      }),
    ).toMatchObject({ code: 'ORDER_LIMIT', limit: 20_000 });

    // Under the total but over qty and over the daily count: quantity wins.
    expect(evaluateOrder([line({ qty: 6 })], limits, { count: 9, spendCents: 9 })).toMatchObject({
      code: 'ORDER_LIMIT',
      limit: 5,
    });

    // Under qty but at the daily cap and out of stock: the daily cap wins.
    expect(
      evaluateOrder([line({ qty: 1, stock: 0 })], limits, { count: 5, spendCents: 0 }),
    ).toMatchObject({ code: 'ORDER_LIMIT', limit: 5 });
  });
});

describe('utcMidnight', () => {
  it('returns the start of the current UTC day', () => {
    const now = new Date('2026-11-26T13:45:12.000Z');
    expect(utcMidnight(now).toISOString()).toBe('2026-11-26T00:00:00.000Z');
  });
});

describe('cancellableUntil', () => {
  it('is now plus the configured window', () => {
    const now = new Date('2026-11-26T13:45:12.000Z');
    expect(cancellableUntil(now, limits).toISOString()).toBe('2026-11-26T14:15:12.000Z');
  });
});
