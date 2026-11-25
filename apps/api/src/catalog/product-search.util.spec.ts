import { describe, expect, it } from 'vitest';
import { dollarsToCents, toFtsMatch } from './product-search.util';

describe('toFtsMatch', () => {
  it('returns undefined for blank input', () => {
    expect(toFtsMatch(undefined)).toBeUndefined();
    expect(toFtsMatch('   ')).toBeUndefined();
    expect(toFtsMatch('!!!')).toBeUndefined();
  });

  it('quotes and prefix-matches each token', () => {
    expect(toFtsMatch('wireless headphones')).toBe('"wireless"* OR "headphones"*');
  });

  it('neutralizes FTS operators and quotes', () => {
    expect(toFtsMatch('a" OR NEAR(b)')).toBe('"a"* OR "or"* OR "near"* OR "b"*');
  });

  it('caps the number of tokens', () => {
    const match = toFtsMatch('one two three four five six seven eight nine ten');
    expect(match?.split(' OR ')).toHaveLength(8);
  });
});

describe('dollarsToCents', () => {
  it('converts and rounds dollars to integer cents', () => {
    expect(dollarsToCents(undefined)).toBeUndefined();
    expect(dollarsToCents(25.5)).toBe(2550);
    expect(dollarsToCents(0.1)).toBe(10);
  });
});
