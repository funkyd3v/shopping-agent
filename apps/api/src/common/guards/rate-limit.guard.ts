import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { getEnv } from '../../config/env';

/**
 * In-process fixed-window rate limiting (PLAN §13/§21.4). Single-instance
 * deployment: no shared store is needed. Auth, chat, cart and checkout have
 * separate buckets; every other route uses the cart limit as a sane default.
 *
 * Identity is the authenticated user when available, otherwise the client IP.
 * Counters and log lines never contain raw IP/user identifiers in details.
 */
export type RateLimitGroup = 'auth' | 'chat' | 'cart' | 'checkout' | 'other';
export type RateLimitConfig = Record<RateLimitGroup, number>;

export const RATE_LIMIT_CONFIG = Symbol('RATE_LIMIT_CONFIG');

export const RATE_LIMIT_WINDOW_MS = 60_000;

export function rateLimitGroup(path: string): RateLimitGroup {
  const normalized = path.split('?')[0]?.replace(/\/+$/, '') || '/';
  if (normalized.startsWith('/auth/')) return 'auth';
  if (normalized === '/rag/chat' || normalized === '/agent/chat') return 'chat';
  if (normalized === '/cart/checkout') return 'checkout';
  if (normalized.startsWith('/cart')) return 'cart';
  return 'other';
}

/** Env is validated at startup; tests may instantiate the guard without ConfigModule. */
function envConfig(): RateLimitConfig {
  const fromEnv = (name: string, fallback: number): number => {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };
  let env: ReturnType<typeof getEnv> | undefined;
  try {
    env = getEnv();
  } catch {
    env = undefined;
  }
  return {
    auth: env?.RATE_LIMIT_AUTH ?? fromEnv('RATE_LIMIT_AUTH', 10),
    chat: env?.RATE_LIMIT_CHAT ?? fromEnv('RATE_LIMIT_CHAT', 20),
    cart: env?.RATE_LIMIT_CART ?? fromEnv('RATE_LIMIT_CART', 60),
    checkout: env?.RATE_LIMIT_CHECKOUT ?? fromEnv('RATE_LIMIT_CHECKOUT', 10),
    other: env?.RATE_LIMIT_CART ?? fromEnv('RATE_LIMIT_CART', 60),
  };
}

type Window = { start: number; count: number };

type RequestWithUser = Request & { user?: { userId: string }; guest?: boolean };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly windows = new Map<string, Window>();

  constructor(
    @Optional()
    @Inject(RATE_LIMIT_CONFIG)
    private readonly config?: Partial<RateLimitConfig>,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const group = rateLimitGroup(req.path ?? '');
    const limit = this.limits()[group];
    // Guests can mint a new identity at will, so keep their budget keyed to IP.
    const identity = req.guest ? (req.ip ?? 'unknown') : (req.user?.userId ?? req.ip ?? 'unknown');
    const key = `${group}:${identity}`;
    const now = Date.now();

    let window = this.windows.get(key);
    if (!window || now - window.start >= RATE_LIMIT_WINDOW_MS) {
      window = { start: now, count: 0 };
      this.windows.set(key, window);
      this.prune(now);
    }
    window.count += 1;
    if (window.count > limit) {
      this.logger.warn(`rate limit group=${group} action=block count=${window.count}/${limit}`);
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please slow down and try again shortly.',
        },
        429,
      );
    }
    return true;
  }

  private limits(): RateLimitConfig {
    return { ...envConfig(), ...(this.config ?? {}) };
  }

  /** Keep the in-process map bounded if many one-off IPs visit the demo. */
  private prune(now: number): void {
    if (this.windows.size < 5_000) return;
    for (const [key, window] of this.windows) {
      if (now - window.start >= RATE_LIMIT_WINDOW_MS) this.windows.delete(key);
    }
  }
}
