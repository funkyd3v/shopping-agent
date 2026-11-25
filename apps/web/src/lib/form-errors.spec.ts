import { describe, expect, it } from 'vitest';
import { stripNestedPrefix, toFieldErrors } from './form-errors';

describe('form error mapping', () => {
  it('keeps the first message per dotted path', () => {
    expect(
      toFieldErrors([
        { path: ['email'], message: 'Enter an email address' },
        { path: ['email'], message: 'Second message is ignored' },
        { path: 'password', message: 'Too short' },
      ]),
    ).toEqual({ email: 'Enter an email address', password: 'Too short' });
  });

  it('flattens nested address paths to field ids', () => {
    expect(
      stripNestedPrefix({
        'address.line1': 'Enter a street address',
        'address.city': 'Enter a city',
        name: 'Enter your name',
      }),
    ).toEqual({ line1: 'Enter a street address', city: 'Enter a city', name: 'Enter your name' });
  });
});
