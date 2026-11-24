import { describe, expect, it } from 'vitest';
import { apiErrorSchema, isErrorCode, registerSchema } from './index.js';

describe('error codes', () => {
  it('accepts known codes', () => {
    expect(isErrorCode('AUTH_REQUIRED')).toBe(true);
    expect(isErrorCode('ORDER_LIMIT')).toBe(true);
  });

  it('rejects unknown codes', () => {
    expect(isErrorCode('HACKED')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });

  it('validates the REST error envelope', () => {
    const parsed = apiErrorSchema.safeParse({
      code: 'VALIDATION_ERROR',
      message: 'bad input',
      requestId: 'req-1',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('register DTO', () => {
  const valid = {
    email: 'Demo@Example.COM',
    password: 'password123',
    name: 'Demo User',
    address: {
      line1: '1 Market St',
      line2: '',
      city: 'Springfield',
      region: 'IL',
      postalCode: '62701',
      country: 'US',
    },
  };

  it('accepts and normalizes a valid registration', () => {
    const result = registerSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('demo@example.com');
      expect(result.data.address?.line2).toBeUndefined();
    }
  });

  it('rejects a weak password and missing address', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    const { address: _address, ...noAddress } = valid;
    expect(registerSchema.safeParse(noAddress).success).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });
});
