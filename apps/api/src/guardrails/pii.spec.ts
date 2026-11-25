import { describe, expect, it } from 'vitest';
import { containsPii, luhnValid, redactPii } from './pii';

describe('PII redaction', () => {
  it('redacts email addresses', () => {
    const result = redactPii('Write to alice@example.com or ALICE+orders@example.co.uk.');
    expect(result.text).toBe('Write to [REDACTED_EMAIL] or [REDACTED_EMAIL].');
    expect(result.findings).toEqual([{ kind: 'email', count: 2 }]);
    expect(containsPii('alice@example.com')).toBe(true);
  });

  it('redacts separated and plain phone numbers', () => {
    const result = redactPii('Call (555) 123-4567, +44 20 7946 0958, or 5551234567.');
    expect(result.text).not.toMatch(/\d{3}/);
    expect(result.text.match(/\[REDACTED_PHONE\]/g)).toHaveLength(3);
    expect(result.findings).toEqual([{ kind: 'phone', count: 3 }]);
  });

  it('redacts Luhn-valid cards and reports validity', () => {
    const result = redactPii('Use 4242 4242 4242 4242 please.');
    expect(result.text).toBe('Use [REDACTED_CARD] please.');
    expect(result.findings).toEqual([{ kind: 'card', count: 1, luhnValid: true }]);
  });

  it('still redacts card-shaped digit runs that fail the checksum', () => {
    const result = redactPii('Reference 1234 5678 9012 3456.');
    expect(result.text).toBe('Reference [REDACTED_CARD].');
    expect(result.findings).toEqual([{ kind: 'card', count: 1, luhnValid: false }]);
  });

  it('leaves order numbers, SKUs, prices, and short numbers alone', () => {
    const input = 'Order ORD-1234 total $59.95, SKU HDP-100, 30 days, 12 months.';
    expect(redactPii(input)).toEqual({ text: input, findings: [] });
    expect(containsPii(input)).toBe(false);
  });

  it('validates Luhn only for 13–19 digit candidates', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('4242 4242 4242 4241')).toBe(false);
    expect(luhnValid('424242')).toBe(false);
  });
});
