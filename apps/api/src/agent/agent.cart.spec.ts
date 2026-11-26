import { describe, expect, it } from 'vitest';
import {
  cartToListedProducts,
  cartToSummary,
  isNonCommittal,
  parseCartIntent,
  parseQuantity,
  summaryToListedProducts,
} from './agent.cart';
import type { ListedProduct } from './agent.types';

const listed: ListedProduct[] = [
  {
    id: 'prod_a',
    name: 'Aurora Wireless Headphones',
    priceCents: 7999,
    ratingAvg: 4.6,
    ratingCount: 12,
    position: 1,
    sku: 'AUD-001',
  },
  {
    id: 'prod_b',
    name: 'Basalt Studio Headphones',
    priceCents: 12999,
    ratingAvg: 4.2,
    ratingCount: 8,
    position: 2,
    sku: 'AUD-002',
  },
  {
    id: 'prod_c',
    name: 'Cobalt Travel Speaker',
    priceCents: 4999,
    ratingAvg: 4.6,
    ratingCount: 4,
    position: 3,
    sku: 'AUD-003',
  },
];

const cartProducts: ListedProduct[] = [
  {
    id: 'prod_b',
    name: 'Basalt Studio Headphones',
    priceCents: 12999,
    ratingAvg: 0,
    ratingCount: 0,
    position: 1,
    sku: 'AUD-002',
  },
  {
    id: 'prod_c',
    name: 'Cobalt Travel Speaker',
    priceCents: 4999,
    ratingAvg: 0,
    ratingCount: 0,
    position: 2,
    sku: 'AUD-003',
  },
];

describe('parseQuantity', () => {
  it('reads a digit quantity from a cart request', () => {
    expect(parseQuantity('add 2 of the second one to my cart')).toBe(2);
  });

  it('does not treat an ordinal as a quantity', () => {
    expect(parseQuantity('add the second one to my cart')).toBeNull();
    expect(parseQuantity('add the 2nd one to my cart')).toBeNull();
  });

  it('reads number words and "a couple"', () => {
    expect(parseQuantity('add two of the second one')).toBe(2);
    expect(parseQuantity('add one to my cart')).toBe(1);
    expect(parseQuantity('add a couple of those to my cart')).toBe(2);
  });

  it('reads an explicit update quantity', () => {
    expect(parseQuantity('change the second one to 3')).toBe(3);
    expect(parseQuantity('set quantity to 4')).toBe(4);
  });

  it('ignores prices and product numbers', () => {
    expect(parseQuantity('add the headphones under $80 to my cart')).toBeNull();
    expect(parseQuantity('add iPhone 15 to my cart')).toBeNull();
  });

  it('does not clamp an over-limit quantity', () => {
    expect(parseQuantity('add 6 of the second one to my cart')).toBe(6);
  });
});

describe('isNonCommittal', () => {
  it('flags hedging language', () => {
    expect(isNonCommittal("I'm thinking about adding the second one")).toBe(true);
    expect(isNonCommittal('maybe add the second one')).toBe(true);
    expect(isNonCommittal('should I add the second one?')).toBe(true);
    expect(isNonCommittal('add the second one to my cart')).toBe(false);
    expect(isNonCommittal("I'd like to add the second one")).toBe(false);
  });
});

describe('parseCartIntent', () => {
  it('views the cart', () => {
    expect(parseCartIntent('show my cart', listed)).toMatchObject({ action: 'view' });
    expect(parseCartIntent("what's in my cart?", listed)).toMatchObject({ action: 'view' });
    expect(parseCartIntent('my cart', listed)).toMatchObject({ action: 'view' });
  });

  it('adds an ordinal product with the user quantity', () => {
    expect(parseCartIntent('add 2 of the second one to my cart', listed)).toMatchObject({
      action: 'add',
      product: { id: 'prod_b' },
      qty: 2,
    });
  });

  it('defaults to one when the product is named without a quantity', () => {
    expect(parseCartIntent('put the travel speaker in my cart', listed)).toMatchObject({
      action: 'add',
      product: { id: 'prod_c' },
      qty: 1,
    });
  });

  it('resolves an explicit SKU', () => {
    expect(parseCartIntent('add AUD-002 to my cart', listed)).toMatchObject({
      action: 'add',
      product: { id: 'prod_b' },
      qty: 1,
    });
  });

  it('asks which product when no list exists', () => {
    expect(parseCartIntent('add the second one to my cart', [])).toMatchObject({
      needsClarification: true,
    });
  });

  it('asks for clarification when the product reference is ambiguous', () => {
    expect(parseCartIntent('add the headphones to my cart', listed)).toMatchObject({
      needsClarification: true,
    });
  });

  it('never commits non-committal language', () => {
    const intent = parseCartIntent("I'm thinking about adding the second one to my cart", listed);
    expect(intent).toMatchObject({ needsClarification: true });
    expect(intent).toHaveProperty('question', expect.stringContaining('have not changed'));
  });

  it('updates a quantity in the cart', () => {
    expect(parseCartIntent('change the travel speaker to 3', listed, cartProducts)).toMatchObject({
      action: 'update',
      product: { id: 'prod_c' },
      qty: 3,
    });
  });

  it('removes a cart line with qty 0', () => {
    expect(parseCartIntent('remove the first one from my cart', [], cartProducts)).toMatchObject({
      action: 'update',
      product: { id: 'prod_b' },
      qty: 0,
    });
    expect(
      parseCartIntent('take the Basalt Studio Headphones out of my cart', listed),
    ).toMatchObject({
      action: 'update',
      product: { id: 'prod_b' },
      qty: 0,
    });
  });

  it('refuses a quantity above the per-item limit', () => {
    expect(parseCartIntent('add 6 of the second one to my cart', listed)).toMatchObject({
      needsClarification: true,
    });
  });

  it('asks for a quantity when an update omits it', () => {
    expect(
      parseCartIntent('change the travel speaker in my cart', listed, cartProducts),
    ).toMatchObject({ needsClarification: true });
  });

  it('does not turn order language into a cart add', () => {
    expect(parseCartIntent('buy the second one', listed)).toMatchObject({
      needsClarification: true,
    });
  });

  it('does not pretend to clear the cart', () => {
    expect(parseCartIntent('clear my cart', listed)).toMatchObject({
      needsClarification: true,
    });
  });

  it('asks for clarification when cart and search lists disagree', () => {
    expect(parseCartIntent('change the second one to 3', listed, cartProducts)).toMatchObject({
      needsClarification: true,
    });
  });
});

describe('cart summary helpers', () => {
  it('maps cart lines to resolvable product references and structured state', () => {
    const cart = {
      id: 'cart_1',
      items: [
        {
          productId: 'prod_b',
          name: 'Basalt Studio Headphones',
          sku: 'AUD-002',
          category: 'Audio',
          imageUrl: null,
          qty: 2,
          unitPriceCents: 12999,
          priceAtAddCents: 12999,
          lineTotalCents: 25998,
          stock: 5,
          priceChanged: false,
          outOfStock: false,
        },
      ],
      subtotalCents: 25998,
      itemCount: 2,
      warnings: [],
      limits: { maxLines: 20, maxQtyPerItem: 5, maxOrderCents: 20000 },
    };

    expect(cartToListedProducts(cart)[0]).toMatchObject({
      id: 'prod_b',
      position: 1,
      sku: 'AUD-002',
    });
    const summary = cartToSummary(cart);
    expect(summary).toEqual({
      items: [
        { productId: 'prod_b', name: 'Basalt Studio Headphones', qty: 2, unitPriceCents: 12999 },
      ],
      subtotalCents: 25998,
    });
    expect(summaryToListedProducts(summary)[0]).toMatchObject({ id: 'prod_b', position: 1 });
    expect(summaryToListedProducts(null)).toEqual([]);
  });
});
