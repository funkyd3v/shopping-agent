import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../db/prisma.service.js';
import { ANONYMOUS_KEY } from '../decorators/public.decorator.js';
import { AnonymousIdentityGuard, GUEST_COOKIE } from './anonymous-identity.guard.js';

type Req = Request & {
  cookies?: Record<string, string>;
  user?: { userId: string };
  guest?: boolean;
};

function context(req: Req, res: Response): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function harness(options: { allowed?: boolean; cookie?: string; guestExists?: boolean } = {}) {
  const req = {
    headers: {},
    ...(options.cookie === undefined ? {} : { cookies: { [GUEST_COOKIE]: options.cookie } }),
  } as unknown as Req;
  const res = { cookie: vi.fn() } as unknown as Response;
  const reflector = {
    getAllAndOverride: vi.fn((key: string) =>
      key === ANONYMOUS_KEY ? (options.allowed ?? false) : undefined,
    ),
  } as unknown as Reflector;
  const jwt = {
    verifyAsync: vi.fn(async (token: string) => {
      if (token !== 'valid-guest') throw new Error('invalid token');
      return { sub: 'guest-1', guest: true };
    }),
    sign: vi.fn(() => 'signed-guest'),
  } as unknown as JwtService;
  const prisma = {
    user: {
      findUnique: vi.fn(async () => (options.guestExists === false ? null : { id: 'guest-1' })),
      create: vi.fn(async () => undefined),
    },
  } as unknown as PrismaService;

  return {
    sut: new AnonymousIdentityGuard(reflector, jwt, prisma),
    req,
    res,
    jwt,
    prisma,
    ctx: context(req, res),
  };
}

describe('AnonymousIdentityGuard', () => {
  it('ignores routes that are not marked anonymous', async () => {
    const { sut, req, res, prisma, ctx } = harness();
    await expect(sut.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toBeUndefined();
    expect(res.cookie).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates a guest user and sets a signed httpOnly cookie on first visit', async () => {
    const { sut, req, res, prisma, ctx } = harness({ allowed: true });
    await expect(sut.canActivate(ctx)).resolves.toBe(true);
    expect(req.user?.userId).toBeTruthy();
    expect(req.guest).toBe(true);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      GUEST_COOKIE,
      'signed-guest',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('reuses an existing guest from a valid cookie', async () => {
    const { sut, req, res, prisma, ctx } = harness({ allowed: true, cookie: 'valid-guest' });
    await expect(sut.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ userId: 'guest-1' });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('issues a new guest for tampered cookies or guests removed by a reset', async () => {
    for (const options of [
      { allowed: true, cookie: 'tampered' },
      { allowed: true, cookie: 'valid-guest', guestExists: false },
    ]) {
      const { sut, req, prisma, ctx } = harness(options);
      await expect(sut.canActivate(ctx)).resolves.toBe(true);
      expect(req.user?.userId).toBeTruthy();
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps a signed-in identity and never overwrites its cookie', async () => {
    const { sut, req, res, prisma, ctx } = harness({ allowed: true });
    req.user = { userId: 'signed-in-user' };
    await expect(sut.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ userId: 'signed-in-user' });
    expect(req.guest).toBeUndefined();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
