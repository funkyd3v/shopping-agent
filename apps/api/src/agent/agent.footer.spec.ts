import { describe, expect, it } from 'vitest';
import {
  buildAgentFooter,
  buildCartFooter,
  buildOrderFooter,
  buildProductFooter,
} from './agent.footer';

describe('agent footers', () => {
  it('builds a numbered product footer from DB data', () => {
    const footer = buildProductFooter([
      {
        id: 'prod_1',
        name: 'Wireless Headphones',
        priceCents: 7999,
        ratingAvg: 4.6,
        ratingCount: 12,
      },
    ]);

    expect(footer).toContain('Products:');
    expect(footer).toContain('1. [Wireless Headphones](/products/prod_1) — $79.99 — 4.6/5');
    expect(footer).not.toContain('4.6/5 — /products/prod_1');
  });

  it('drops square brackets from link text so the markdown link stays valid', () => {
    const footer = buildProductFooter([
      { id: 'prod_1', name: '[Refurb] Headphones', priceCents: 1000, ratingAvg: 4, ratingCount: 1 },
    ]);
    expect(footer).toContain('[Refurb Headphones](/products/prod_1)');
  });

  it('says when a product has no ratings', () => {
    const footer = buildProductFooter([
      { id: 'prod_1', name: 'New Thing', priceCents: 1000, ratingAvg: 0, ratingCount: 0 },
    ]);
    expect(footer).toContain('no ratings yet');
  });

  it('builds an order footer with safe links', () => {
    const footer = buildOrderFooter([
      {
        id: 'order_1',
        orderNumber: 'ORD-1001',
        status: 'delivered',
        totalCents: 2599,
        currency: 'USD',
      },
    ]);

    expect(footer).toContain('Orders:');
    expect(footer).toContain('1. ORD-1001 — delivered — $25.99 — /orders/order_1');
  });

  it('strips markup from labels and never emits an unsafe id link', () => {
    const footer = buildProductFooter([
      {
        id: 'bad id',
        name: '<script>alert(1)</script>Headphones',
        priceCents: 1000,
        ratingAvg: 4,
        ratingCount: 1,
      },
    ]);

    expect(footer).not.toContain('<script>');
    expect(footer).not.toContain('/products/bad id');
    expect(footer).toContain('Headphones');
  });

  it('builds a cart footer with quantities, line totals, and the cart link', () => {
    const footer = buildCartFooter({
      items: [{ productId: 'prod_1', name: 'Wireless Headphones', qty: 2, unitPriceCents: 7999 }],
      subtotalCents: 15_998,
    });

    expect(footer).toContain('Cart:');
    expect(footer).toContain('1. Wireless Headphones — 2 × $79.99 = $159.98');
    expect(footer).toContain('Subtotal: $159.98');
    expect(footer).toContain('/cart');
  });

  it('marks an empty cart footer', () => {
    expect(buildCartFooter({ items: [], subtotalCents: 0 })).toContain('Cart: empty');
  });

  it('strips markup from cart labels', () => {
    const footer = buildCartFooter({
      items: [
        {
          productId: 'prod_1',
          name: '<script>alert(1)</script>Headphones',
          qty: 1,
          unitPriceCents: 1000,
        },
      ],
      subtotalCents: 1000,
    });

    expect(footer).not.toContain('<script>');
    expect(footer).toContain('Headphones');
  });

  it('builds a full receipt with items, total, status, deadline, and link', () => {
    const footer = buildOrderFooter([
      {
        id: 'order_1',
        orderNumber: 'ORD-7F3K2',
        status: 'placed',
        totalCents: 15_998,
        currency: 'USD',
        receipt: true,
        source: 'cart',
        placedBy: 'agent',
        items: [{ name: 'Wireless Headphones', qty: 2, unitPriceCents: 7999 }],
        cancellableUntil: '2099-01-01T12:00:00.000Z',
      },
    ]);

    expect(footer).toContain('Receipt:');
    expect(footer).toContain('ORD-7F3K2 — placed by the assistant — from your cart');
    expect(footer).toContain('1. Wireless Headphones — 2 × $79.99 = $159.98');
    expect(footer).toContain('Total: $159.98');
    expect(footer).toContain('Status: placed — cancellable until');
    expect(footer).toContain('/orders/order_1');
  });

  it('marks a cancelled receipt and omits a stale cancel deadline', () => {
    const footer = buildOrderFooter([
      {
        id: 'order_1',
        orderNumber: 'ORD-7F3K2',
        status: 'cancelled',
        totalCents: 2599,
        currency: 'USD',
        receipt: true,
        placedBy: 'user',
        cancelledBy: 'agent',
        cancelledAt: '2026-11-26T00:00:00.000Z',
        cancellableUntil: '2026-11-26T00:30:00.000Z',
        items: [{ name: 'Budget Buds', qty: 1, unitPriceCents: 2599 }],
      },
    ]);

    expect(footer).toContain('placed by you');
    expect(footer).toContain('Status: cancelled by the assistant');
    expect(footer).not.toContain('cancellable until');
  });

  it('keeps compact history rows when no receipt is present', () => {
    const footer = buildOrderFooter([
      {
        id: 'order_1',
        orderNumber: 'ORD-1001',
        status: 'delivered',
        totalCents: 2599,
        currency: 'USD',
      },
    ]);

    expect(footer).toContain('Orders:');
    expect(footer).not.toContain('Receipt:');
  });

  it('returns an empty string when there are no rows', () => {
    expect(buildAgentFooter([], [])).toBe('');
  });
});
