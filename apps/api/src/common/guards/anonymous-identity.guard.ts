import { randomUUID } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { ulid } from 'ulid';
import { PrismaService } from '../../db/prisma.service.js';
import { setContextUserId } from '../context/request-context.js';
import { ANONYMOUS_KEY } from '../decorators/public.decorator.js';

export const GUEST_COOKIE = 'guest_session';
const GUEST_TTL_SEC = 30 * 24 * 60 * 60;

type GuestPayload = { sub: string; guest: true };
type RequestWithUser = Request & { user?: { userId: string }; guest?: boolean };

/**
 * Guest identity for routes marked `@AllowAnonymous()` (currently the policy
 * help chat). A signed httpOnly cookie maps each browser to its own User row,
 * so sessions, guardrail_events and token_usage keep their real FKs and one
 * visitor can never read another visitor's transcript (PLAN §13 ownership).
 * A signed-in request always keeps its authenticated identity.
 */
@Injectable()
export class AnonymousIdentityGuard implements CanActivate {
  private guestHash?: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ANONYMOUS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!allowed) return true;

    const http = ctx.switchToHttp();
    const req = http.getRequest<RequestWithUser>();
    if (req.user?.userId) return true;

    let userId = await this.userIdFromCookie(req.cookies?.[GUEST_COOKIE]);
    if (!userId) {
      userId = await this.createGuest();
      this.setCookie(http.getResponse<Response>(), userId);
    }

    req.user = { userId };
    // Rate-limit guests by IP: rotating guest cookies must not reset the
    // per-IP budget (PLAN §21.4).
    req.guest = true;
    setContextUserId(userId);
    return true;
  }

  private async userIdFromCookie(token: unknown): Promise<string | undefined> {
    if (typeof token !== 'string' || token.length === 0) return undefined;
    try {
      const payload = await this.jwt.verifyAsync<GuestPayload>(token);
      if (payload.guest !== true || typeof payload.sub !== 'string' || payload.sub.length === 0) {
        return undefined;
      }
      // A reset can remove the guest row; issue a fresh identity in that case.
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true },
      });
      return user?.id;
    } catch {
      return undefined;
    }
  }

  private async createGuest(): Promise<string> {
    const id = ulid();
    // One unusable hash shared by guests: argon2.verify can never succeed for
    // a password nobody knows, so a guest row cannot be used to log in.
    this.guestHash ??= await argon2.hash(randomUUID(), { type: argon2.argon2id });
    await this.prisma.user.create({
      data: {
        id,
        email: `guest-${id.toLowerCase()}@anonymous.invalid`,
        name: 'Guest',
        passwordHash: this.guestHash,
      },
    });
    return id;
  }

  private setCookie(res: Response, userId: string): void {
    const token = this.jwt.sign({ sub: userId, guest: true } satisfies GuestPayload, {
      expiresIn: GUEST_TTL_SEC,
    });
    res.cookie(GUEST_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: GUEST_TTL_SEC * 1000,
    });
  }
}
