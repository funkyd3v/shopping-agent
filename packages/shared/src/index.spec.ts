import { describe, expect, it } from 'vitest';
import {
  addCartItemSchema,
  apiErrorSchema,
  isErrorCode,
  productListQuerySchema,
  registerSchema,
  updateCartItemSchema,
} from './index.js';

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

describe('product list query DTO', () => {
  it('applies defaults and normalizes empty strings', () => {
    const parsed = productListQuerySchema.parse({ q: '', category: '', limit: '', offset: '' });
    expect(parsed).toEqual({ q: undefined, category: undefined, limit: 20, offset: 0 });
  });

  it('coerces dollar filters and paging values', () => {
    const parsed = productListQuerySchema.parse({ minPrice: '25.5', maxPrice: '80', limit: '10' });
    expect(parsed.minPrice).toBe(25.5);
    expect(parsed.maxPrice).toBe(80);
    expect(parsed.limit).toBe(10);
  });

  it('rejects an inverted price range and an oversized limit', () => {
    expect(productListQuerySchema.safeParse({ minPrice: '90', maxPrice: '10' }).success).toBe(
      false,
    );
    expect(productListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('cart DTOs', () => {
  it('defaults add-to-cart quantity to 1 and rejects qty 6', () => {
    const parsed = addCartItemSchema.parse({ productId: 'p1' });
    expect(parsed.qty).toBe(1);
    expect(addCartItemSchema.safeParse({ productId: 'p1', qty: 6 }).success).toBe(false);
  });

  it('allows qty 0 to remove a line', () => {
    const parsed = updateCartItemSchema.parse({ qty: 0 });
    expect(parsed.qty).toBe(0);
  });
});
