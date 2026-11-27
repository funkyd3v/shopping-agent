import type { ExecutionContext } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type RateLimitConfig, RateLimitGuard, rateLimitGroup } from './rate-limit.guard';

function context(path: string, userId?: string, ip = '127.0.0.1'): ExecutionContext {
  const req = {
    path,
    ip,
    ...(userId ? { user: { userId } } : {}),
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guard(): RateLimitGuard {
  return new RateLimitGuard({
    auth: 2,
    chat: 2,
    cart: 5,
    checkout: 1,
    other: 3,
  } satisfies Partial<RateLimitConfig>);
}

describe('rateLimitGroup', () => {
  it('classifies the stricter buckets before the generic cart bucket', () => {
    expect(rateLimitGroup('/auth/login')).toBe('auth');
    expect(rateLimitGroup('/agent/chat')).toBe('chat');
    expect(rateLimitGroup('/rag/chat')).toBe('chat');
    expect(rateLimitGroup('/cart/checkout')).toBe('checkout');
    expect(rateLimitGroup('/cart/items/abc?q=1')).toBe('cart');
    expect(rateLimitGroup('/products')).toBe('other');
  });
});

describe('RateLimitGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests inside the window and returns RATE_LIMITED when exceeded', () => {
    const sut = guard();
    expect(sut.canActivate(context('/auth/login'))).toBe(true);
    expect(sut.canActivate(context('/auth/login'))).toBe(true);
    try {
      sut.canActivate(context('/auth/login'));
      throw new Error('expected a 429');
    } catch (error) {
      expect((error as { getStatus: () => number }).getStatus()).toBe(429);
      expect((error as { getResponse: () => { code: string } }).getResponse()).toMatchObject({
        code: 'RATE_LIMITED',
      });
    }
  });

  it('uses distinct buckets for auth, chat, cart, checkout and other routes', () => {
    const sut = guard();
    for (const path of ['/auth/login', '/agent/chat', '/cart', '/cart/checkout', '/products']) {
      expect(sut.canActivate(context(path, 'user-1'))).toBe(true);
    }
    // checkout is stricter: the second attempt is already refused.
    expect(() => sut.canActivate(context('/cart/checkout', 'user-1'))).toThrow();
    // the other buckets still have capacity.
    expect(sut.canActivate(context('/agent/chat', 'user-1'))).toBe(true);
  });

  it('keys by authenticated user, so two users do not share a bucket', () => {
    const sut = guard();
    expect(sut.canActivate(context('/agent/chat', 'user-1'))).toBe(true);
    expect(sut.canActivate(context('/agent/chat', 'user-1'))).toBe(true);
    expect(sut.canActivate(context('/agent/chat', 'user-2'))).toBe(true);
  });

  it('resets the counter after the fixed window', () => {
    const sut = guard();
    expect(sut.canActivate(context('/auth/login', 'user-1'))).toBe(true);
    expect(sut.canActivate(context('/auth/login', 'user-1'))).toBe(true);
    expect(() => sut.canActivate(context('/auth/login', 'user-1'))).toThrow();
    vi.advanceTimersByTime(60_000);
    expect(sut.canActivate(context('/auth/login', 'user-1'))).toBe(true);
  });
});
