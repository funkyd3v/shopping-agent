import { describe, expect, it } from 'vitest';
import { parseChatLinks } from './chat-links';

describe('parseChatLinks', () => {
  it('leaves plain text alone', () => {
    expect(parseChatLinks('Here are your products.')).toEqual([
      { type: 'text', text: 'Here are your products.' },
    ]);
  });

  it('linkifies bare product, order, and cart paths', () => {
    const segments = parseChatLinks('Open /products/prod_1, /orders/order_1, or /cart.');
    expect(segments).toEqual([
      { type: 'text', text: 'Open ' },
      { type: 'link', href: '/products/prod_1', label: '/products/prod_1' },
      { type: 'text', text: ', ' },
      { type: 'link', href: '/orders/order_1', label: '/orders/order_1' },
      { type: 'text', text: ', or ' },
      { type: 'link', href: '/cart', label: '/cart' },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps safe markdown links and drops unsafe ones', () => {
    expect(parseChatLinks('[the cart](/cart)')).toEqual([
      { type: 'link', href: '/cart', label: 'the cart' },
    ]);
    expect(parseChatLinks('[click](javascript:alert(1))')).toEqual([
      { type: 'text', text: 'click' },
    ]);
  });

  it('does not linkify store-looking paths inside external URLs', () => {
    expect(parseChatLinks('https://example.com/products/prod_1')).toEqual([
      { type: 'text', text: 'https://example.com/products/prod_1' },
    ]);
  });

  it('does not linkify deeper or partial paths', () => {
    expect(parseChatLinks('/products/prod_1/reviews and /cartoon')).toEqual([
      { type: 'text', text: '/products/prod_1/reviews and /cartoon' },
    ]);
  });

  it('leaves a trailing period outside the link', () => {
    const segments = parseChatLinks('See /products/prod_1.');
    expect(segments.at(-1)).toEqual({ type: 'text', text: '.' });
  });
});
