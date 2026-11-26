import { describe, expect, it } from 'vitest';
import { parseSearchFallback, resolveProductReference } from './agent.refs';
import type { ListedProduct } from './agent.types';

const listed: ListedProduct[] = [
  {
    id: 'prod_a',
    name: 'Aurora Wireless Headphones',
    priceCents: 7999,
    ratingAvg: 4.6,
    ratingCount: 12,
    position: 1,
  },
  {
    id: 'prod_b',
    name: 'Basalt Studio Headphones',
    priceCents: 12999,
    ratingAvg: 4.2,
    ratingCount: 8,
    position: 2,
  },
  {
    id: 'prod_c',
    name: 'Cobalt Travel Speaker',
    priceCents: 4999,
    ratingAvg: 4.6,
    ratingCount: 4,
    position: 3,
  },
];

describe('resolveProductReference', () => {
  it('returns null without a product list', () => {
    expect(resolveProductReference('the second one', [])).toBeNull();
  });

  it('resolves explicit ids and ordinals', () => {
    expect(resolveProductReference('reviews for prod_b please', listed)).toMatchObject({
      product: { id: 'prod_b' },
      reason: 'explicit product id',
    });
    expect(resolveProductReference('summarize reviews for the second one', listed)).toMatchObject({
      product: { id: 'prod_b' },
      reason: 'ordinal',
    });
  });

  it('rejects ordinals outside the list', () => {
    expect(resolveProductReference('the fifth one', listed)).toEqual({
      ambiguous: true,
      reason: 'ordinal out of range',
    });
  });

  it('resolves cheapest, most expensive, and rating phrases', () => {
    expect(resolveProductReference('how is the cheapest?', listed)).toMatchObject({
      product: { id: 'prod_c' },
    });
    expect(resolveProductReference('the most expensive one', listed)).toMatchObject({
      product: { id: 'prod_b' },
    });
    expect(resolveProductReference('the highest rated one', listed)).toEqual({
      ambiguous: true,
      reason: 'multiple equally rated products',
    });
  });

  it('resolves full names and unique name tokens', () => {
    expect(
      resolveProductReference('tell me about Aurora Wireless Headphones', listed),
    ).toMatchObject({
      product: { id: 'prod_a' },
    });
    expect(resolveProductReference('the travel speaker', listed)).toMatchObject({
      product: { id: 'prod_c' },
    });
  });

  it('treats ambiguous name tokens as ambiguous', () => {
    expect(resolveProductReference('the headphones', listed)).toEqual({
      ambiguous: true,
      reason: 'multiple product matches',
    });
  });

  it('allows "it" only when exactly one product is listed', () => {
    expect(resolveProductReference('reviews for it', [listed[0] as ListedProduct])).toMatchObject({
      product: { id: 'prod_a' },
      reason: 'single listed product',
    });
    expect(resolveProductReference('reviews for it', listed)).toBeNull();
  });
});

describe('parseSearchFallback', () => {
  it('extracts a price ceiling, floor, and category from the message', () => {
    expect(parseSearchFallback('find audio over $20 and under $80 please')).toMatchObject({
      category: 'Audio',
      minPrice: 20,
      maxPrice: 80,
    });
  });

  it('removes filler words from the query', () => {
    const parsed = parseSearchFallback('show me some wireless headphones');
    expect(parsed.query?.toLowerCase()).toContain('wireless');
    expect(parsed.query?.toLowerCase()).not.toContain('show');
  });
});
