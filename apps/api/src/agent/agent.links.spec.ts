import { describe, expect, it } from 'vitest';
import { linkifyProductPaths, productChatLink } from './agent.links';

describe('productChatLink', () => {
  it('uses the product name as the link text', () => {
    expect(productChatLink('prod_1', 'Wireless Headphones')).toBe(
      '[Wireless Headphones](/products/prod_1)',
    );
  });

  it('strips markup and square brackets from the link text', () => {
    expect(productChatLink('prod_1', '<b>[Refurb]</b> Headphones')).toBe(
      '[Refurb Headphones](/products/prod_1)',
    );
  });

  it('refuses an id that cannot form a safe store route', () => {
    expect(productChatLink('bad id', 'Headphones')).toBeNull();
  });
});

describe('linkifyProductPaths', () => {
  const products = [{ id: 'prod_1', name: 'Wireless Headphones' }];

  it('replaces a bare product path with a named markdown link', () => {
    expect(linkifyProductPaths('See /products/prod_1 for details.', products)).toBe(
      'See [Wireless Headphones](/products/prod_1) for details.',
    );
  });

  it('leaves an existing markdown link untouched', () => {
    const text = 'See [Wireless Headphones](/products/prod_1).';
    expect(linkifyProductPaths(text, products)).toBe(text);
  });

  it('leaves external URLs and deeper paths untouched', () => {
    expect(
      linkifyProductPaths(
        'https://example.com/products/prod_1 and /products/prod_1/reviews',
        products,
      ),
    ).toBe('https://example.com/products/prod_1 and /products/prod_1/reviews');
  });

  it('falls back to a generic label for an unknown product id', () => {
    expect(linkifyProductPaths('Open /products/prod_9.', products)).toBe(
      'Open [this product](/products/prod_9).',
    );
  });

  it('returns text without product paths unchanged', () => {
    expect(linkifyProductPaths('Here are the results.', products)).toBe('Here are the results.');
  });
});
