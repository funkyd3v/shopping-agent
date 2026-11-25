import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';

export interface AuthUser {
  userId: string;
}

/** Resolves the authenticated user injected by JwtAuthGuard (never from the body). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user,
);

/**
 * Narrows the optional guard result for controllers. The global guard already
 * rejects unauthenticated requests; this keeps the type honest if a route is
 * ever marked @Public by mistake.
 */
export function requireUserId(ctx: AuthUser | undefined): string {
  if (!ctx?.userId) {
    throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Authentication required.' });
  }
  return ctx.userId;
}
