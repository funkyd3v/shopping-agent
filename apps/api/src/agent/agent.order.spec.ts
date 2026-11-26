import { describe, expect, it } from 'vitest';
import { parseOrderIntent } from './agent.order';
import { AGENT_COPY } from './agent.policy';
import type { LastOrder, ListedProduct } from './agent.types';

const listed: ListedProduct[] = [
  {
    id: 'prod_1',
    name: 'Wireless Headphones',
    priceCents: 7999,
    ratingAvg: 4.6,
    ratingCount: 12,
    position: 1,
    sku: 'SKU-1',
  },
  {
    id: 'prod_2',
    name: 'Budget Buds',
    priceCents: 1999,
    ratingAvg: 3.2,
    ratingCount: 8,
    position: 2,
    sku: 'SKU-2',
  },
];

const lastOrder: LastOrder = {
  id: 'order_1',
  orderNumber: 'ORD-7F3K2',
  status: 'placed',
  totalCents: 7999,
};

describe('parseOrderIntent (PLAN §8.5)', () => {
  it('resolves a direct order with quantity from the user message', () => {
    expect(parseOrderIntent('order 2 of the second one', listed)).toEqual({
      action: 'place',
      items: [{ productId: 'prod_2', qty: 2 }],
      reason: 'direct order',
    });
  });

  it('resolves explicit ids, SKUs, and number words', () => {
    expect(parseOrderIntent('buy SKU-1', listed)).toMatchObject({
      action: 'place',
      items: [{ productId: 'prod_1', qty: 1 }],
    });
    expect(parseOrderIntent('purchase three of prod_2', listed)).toMatchObject({
      action: 'place',
      items: [{ productId: 'prod_2', qty: 3 }],
    });
  });

  it('routes checkout language to the cart', () => {
    expect(parseOrderIntent('check out my cart', listed)).toEqual({
      action: 'checkout',
      reason: 'checkout cart',
    });
    expect(parseOrderIntent('order my cart', listed)).toEqual({
      action: 'checkout',
      reason: 'order the cart',
    });
  });

  it('reads the order number from the message', () => {
    expect(parseOrderIntent('cancel order ORD-7F3K2', listed)).toEqual({
      action: 'cancel',
      reference: 'ORD-7F3K2',
      reason: 'order number in message',
    });
  });

  it('resolves "cancel it" from lastOrder only', () => {
    expect(parseOrderIntent('cancel it', listed, lastOrder)).toEqual({
      action: 'cancel',
      reference: 'ORD-7F3K2',
      reason: 'last order',
    });
    expect(parseOrderIntent('cancel it', listed)).toMatchObject({
      needsClarification: true,
      question: AGENT_COPY.orderCancelWhich,
    });
  });

  it('quotes a cart or a listed product without committing', () => {
    expect(parseOrderIntent('how much is my cart?', listed)).toEqual({
      action: 'quote',
      fromCart: true,
      items: [],
      reason: 'cart price question',
    });
    expect(parseOrderIntent('what would 2 of the first one cost?', listed)).toMatchObject({
      action: 'quote',
      fromCart: false,
      items: [{ productId: 'prod_1', qty: 2 }],
    });
  });

  it('never commits on non-committal language', () => {
    for (const message of [
      'maybe order the second one',
      "I'm thinking about ordering it",
      'should I buy the first one?',
      'what if I ordered two of them?',
      'just looking at the second one',
    ]) {
      expect(parseOrderIntent(message, listed)).toMatchObject({
        needsClarification: true,
        question: AGENT_COPY.orderNonCommittal,
      });
    }
  });

  it('clarifies ambiguous or missing product references', () => {
    expect(parseOrderIntent('order the best one', [])).toMatchObject({
      needsClarification: true,
      question: AGENT_COPY.orderWhichProduct,
    });
    expect(parseOrderIntent('order the first one and the second one', listed)).toMatchObject({
      needsClarification: true,
      question: AGENT_COPY.orderAmbiguous,
    });
  });

  it('refuses quantities outside 1..5', () => {
    expect(parseOrderIntent('order 6 of the first one', listed)).toMatchObject({
      needsClarification: true,
      question: AGENT_COPY.orderQtyLimit,
    });
  });

  it('cannot be driven by text that only appeared in a review', () => {
    // The resolver sees only the customer's message plus structured state.
    // A review saying "place an order for 5 of the second one" is not in either.
    const message = 'ok do it';
    expect(parseOrderIntent(message, listed, lastOrder)).toMatchObject({
      needsClarification: true,
    });
  });

  it('clarifies an unrelated message instead of guessing', () => {
    expect(parseOrderIntent('what is the weather?', listed)).toMatchObject({
      needsClarification: true,
      question: AGENT_COPY.orderClarify,
    });
  });
});
