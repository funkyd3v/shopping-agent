import { describe, expect, it } from 'vitest';
import { detectRedundancy, normalizedTokens, tokenJaccard } from './redundancy';

const longReply =
  'Here are the products that best match your request. The first one is a pair of wireless headphones with a rating of 4.5 stars and a price of 79 dollars. The second one is a different model with a rating of 4.2 stars.';

describe('tokenJaccard', () => {
  it('normalizes case, punctuation and links', () => {
    expect([...normalizedTokens('Hello, World! HELLO')]).toEqual(['hello', 'world']);
    expect(tokenJaccard('Hello world', 'hello, WORLD!')).toBe(1);
    expect(tokenJaccard('alpha beta', 'gamma delta')).toBe(0);
  });
});

describe('detectRedundancy', () => {
  it('flags a near-duplicate reply', () => {
    const verdict = detectRedundancy({ reply: longReply, assistantHistory: [longReply] });
    expect(verdict.redundant).toBe(true);
    expect(verdict.reason).toBe('near-duplicate-reply');
    expect(verdict.rule).toBe('redundancy.duplicate_reply');
  });

  it('ignores short acknowledgements', () => {
    const verdict = detectRedundancy({ reply: 'Done.', assistantHistory: ['Done.'] });
    expect(verdict.redundant).toBe(false);
  });

  it('flags three identical tool calls as a loop', () => {
    const verdict = detectRedundancy({
      reply: 'Here is what I found.',
      assistantHistory: [],
      toolCalls: [
        { name: 'search_products', args: { query: 'headphones' } },
        { name: 'search_products', args: { query: 'headphones' } },
        { name: 'search_products', args: { query: 'headphones' } },
      ],
    });
    expect(verdict.redundant).toBe(true);
    expect(verdict.reason).toBe('repeated-tool');
    expect(verdict.score).toBe(3);
  });

  it('allows up to the configured number of repeated tool calls', () => {
    const verdict = detectRedundancy({
      reply: 'Here is what I found.',
      assistantHistory: [],
      toolCalls: [
        { name: 'search_products', args: { query: 'headphones' } },
        { name: 'search_products', args: { query: 'headphones' } },
      ],
    });
    expect(verdict.redundant).toBe(false);
  });

  it('never suppresses an explicit re-request', () => {
    const verdict = detectRedundancy({
      reply: longReply,
      assistantHistory: [longReply],
      userMessage: 'Say that again, please.',
    });
    expect(verdict.redundant).toBe(false);
  });

  it('never suppresses receipts or cart summaries', () => {
    const verdict = detectRedundancy({
      reply: longReply,
      assistantHistory: [longReply],
      toolCalls: [{ name: 'place_order', args: {} }],
    });
    expect(verdict.redundant).toBe(false);
  });

  it('honours a custom similarity threshold', () => {
    const other =
      'Completely different guidance about shipping windows, refund timing, warranty coverage and payment methods for your orders.';
    const verdict = detectRedundancy({ reply: longReply, assistantHistory: [other], threshold: 0 });
    expect(verdict.redundant).toBe(true);
  });
});
