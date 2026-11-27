import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../db/prisma.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

type Req = {
  headers: Record<string, string>;
  cookies?: Record<string, string>;
  user?: { userId: string };
};

function context(req: Req): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function harness(
  options: {
    isPublic?: boolean;
    token?: string;
    sub?: string;
    userExists?: boolean;
    dbError?: Error;
  } = {},
) {
  const req: Req = {
    headers: {},
    ...(options.token === undefined ? {} : { cookies: { access_token: options.token } }),
  };
  const reflector = {
    getAllAndOverride: vi.fn(() => options.isPublic ?? false),
  } as unknown as Reflector;
  const jwt = {
    verifyAsync: vi.fn(async () => {
      if (options.token !== 'valid') throw new Error('jwt malformed');
      return { sub: options.sub ?? 'user-1' };
    }),
  } as unknown as JwtService;
  const prisma = {
    user: {
      findUnique: options.dbError
        ? vi.fn(() => Promise.reject(options.dbError))
        : vi.fn(async () =>
            options.userExists === false ? null : { id: options.sub ?? 'user-1' },
          ),
    },
  } as unknown as PrismaService;

  return { sut: new JwtAuthGuard(reflector, jwt, prisma), req, ctx: context(req) };
}

async function expectUnauthorized(result: Promise<unknown>): Promise<void> {
  try {
    await result;
    throw new Error('expected UnauthorizedException');
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  }
}

describe('JwtAuthGuard', () => {
  it('accepts a valid token when the user still exists', async () => {
    const { sut, req, ctx } = harness({ token: 'valid' });
    await expect(sut.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ userId: 'user-1' });
  });

  it('rejects a valid token whose user was removed by a reset', async () => {
    const { sut, req, ctx } = harness({ token: 'valid', userExists: false });
    await expectUnauthorized(sut.canActivate(ctx));
    expect(req.user).toBeUndefined();
  });

  it('rejects missing and invalid tokens on protected routes', async () => {
    const missing = harness();
    await expectUnauthorized(missing.sut.canActivate(missing.ctx));
    const invalid = harness({ token: 'garbage' });
    await expectUnauthorized(invalid.sut.canActivate(invalid.ctx));
  });

  it('lets public routes through with a stale token, without setting a user', async () => {
    const { sut, req, ctx } = harness({ token: 'valid', userExists: false, isPublic: true });
    await expect(sut.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toBeUndefined();
  });

  it('does not mask database failures as auth failures', async () => {
    const { sut, ctx } = harness({ token: 'valid', dbError: new Error('db down') });
    await expect(sut.canActivate(ctx)).rejects.toThrow('db down');
  });
});
