import type { CartLimits } from '@shopping-agent/shared';
import { describe, expect, it } from 'vitest';
import { buildCartView, type CartRow } from './cart.mapper';

const limits: CartLimits = { maxLines: 20, maxQtyPerItem: 5, maxOrderCents: 20_000 };

function cartWith(
  items: Array<{
    productId: string;
    qty: number;
    priceAtAddCents: number;
    priceCents: number;
    stock?: number;
    name?: string;
  }>,
): CartRow {
  return {
    id: 'cart_1',
    items: items.map((item) => ({
      productId: item.productId,
      qty: item.qty,
      priceAtAddCents: item.priceAtAddCents,
      product: {
        name: item.name ?? item.productId,
        sku: `SKU-${item.productId}`,
        category: 'Test',
        imageUrl: null,
        priceCents: item.priceCents,
        stock: item.stock ?? 10,
      },
    })),
  };
}

describe('buildCartView', () => {
  it('returns an empty view before the cart is created', () => {
    const view = buildCartView(null, limits);
    expect(view.id).toBeNull();
    expect(view.items).toEqual([]);
    expect(view.subtotalCents).toBe(0);
    expect(view.itemCount).toBe(0);
    expect(view.warnings).toEqual([]);
    expect(view.limits).toEqual(limits);
  });

  it('uses current prices for line totals and subtotal', () => {
    const view = buildCartView(
      cartWith([
        { productId: 'p1', qty: 2, priceAtAddCents: 1000, priceCents: 1000 },
        { productId: 'p2', qty: 1, priceAtAddCents: 500, priceCents: 500 },
      ]),
      limits,
    );
    expect(view.subtotalCents).toBe(2500);
    expect(view.itemCount).toBe(3);
    expect(view.items.map((line) => line.lineTotalCents)).toEqual([2000, 500]);
    expect(view.warnings).toEqual([]);
  });

  it('warns when the price changed after adding', () => {
    const view = buildCartView(
      cartWith([{ productId: 'p1', qty: 1, priceAtAddCents: 1000, priceCents: 1200 }]),
      limits,
    );
    expect(view.items[0]?.priceChanged).toBe(true);
    expect(view.items[0]?.lineTotalCents).toBe(1200);
    expect(view.warnings).toContainEqual(
      expect.objectContaining({ code: 'PRICE_CHANGED', productId: 'p1' }),
    );
  });

  it('warns about out-of-stock and insufficient-stock lines', () => {
    const view = buildCartView(
      cartWith([
        { productId: 'p1', qty: 1, priceAtAddCents: 1000, priceCents: 1000, stock: 0 },
        { productId: 'p2', qty: 3, priceAtAddCents: 500, priceCents: 500, stock: 2 },
      ]),
      limits,
    );
    const stockWarnings = view.warnings.filter((warning) => warning.code === 'OUT_OF_STOCK');
    expect(stockWarnings).toHaveLength(2);
    expect(view.items[0]?.outOfStock).toBe(true);
    expect(view.items[1]?.outOfStock).toBe(false);
  });

  it('warns when the subtotal exceeds the per-order limit', () => {
    const view = buildCartView(
      cartWith([{ productId: 'p1', qty: 1, priceAtAddCents: 25_000, priceCents: 25_000 }]),
      limits,
    );
    expect(view.warnings).toContainEqual(expect.objectContaining({ code: 'CART_OVER_LIMIT' }));
  });

  it('flags a line above the qty limit', () => {
    const view = buildCartView(
      cartWith([{ productId: 'p1', qty: 6, priceAtAddCents: 100, priceCents: 100 }]),
      limits,
    );
    expect(view.warnings).toContainEqual(expect.objectContaining({ code: 'QTY_LIMIT' }));
  });
});
