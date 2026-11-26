import { describe, expect, it } from 'vitest';
import { buildAgentFooter, buildOrderFooter, buildProductFooter } from './agent.footer';

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
    expect(footer).toContain('1. Wireless Headphones — $79.99 — 4.6/5 — /products/prod_1');
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

  it('returns an empty string when there are no rows', () => {
    expect(buildAgentFooter([], [])).toBe('');
  });
});
