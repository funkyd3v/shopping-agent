import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { setContextUserId } from '../context/request-context.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

export const AUTH_COOKIE = 'access_token';

type RequestWithAuth = Request & {
  user?: { userId: string };
};

/**
 * Global JWT guard: httpOnly cookie (`access_token`) or Authorization: Bearer.
 * Public routes (@Public) pass through without a token. Payload is { sub, iat, exp }.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? false;

    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    const cookieToken = req.cookies?.[AUTH_COOKIE];
    const token =
      typeof cookieToken === 'string' ? cookieToken : extractBearer(req.headers.authorization);

    if (!token) {
      return this.allowOrThrow(isPublic);
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        return this.allowOrThrow(isPublic);
      }
      req.user = { userId: payload.sub };
      setContextUserId(payload.sub);
      return true;
    } catch {
      return this.allowOrThrow(isPublic);
    }
  }

  private allowOrThrow(isPublic: boolean): boolean {
    if (isPublic) return true;
    throw new UnauthorizedException({
      code: 'AUTH_REQUIRED',
      message: 'Authentication required.',
    });
  }
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
  return value;
}
