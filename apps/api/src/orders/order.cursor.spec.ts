import { describe, expect, it } from 'vitest';
import { decodeOrderCursor, encodeOrderCursor } from './order.cursor';

describe('order cursor', () => {
  it('round-trips createdAt and id', () => {
    const cursor = { createdAt: new Date('2026-11-25T10:00:00.000Z'), id: 'ord_01' };
    expect(decodeOrderCursor(encodeOrderCursor(cursor))).toEqual(cursor);
  });

  it('produces an opaque base64url string', () => {
    const encoded = encodeOrderCursor({ createdAt: new Date(0), id: 'ord_01' });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain('ord_01');
  });

  it('rejects malformed cursors with a validation error', () => {
    for (const value of ['', 'not-base64!!', 'bm8tc2VwYXJhdG9y']) {
      expect(() => decodeOrderCursor(value)).toThrow(/Invalid cursor/);
    }
  });
});
