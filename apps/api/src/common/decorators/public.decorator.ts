import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const ANONYMOUS_KEY = 'allowAnonymous';

/** Marks a route as not requiring JWT (auth routes, health, etc.). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Marks a route callable without a sign-in. `AnonymousIdentityGuard` gives it
 * a per-browser guest identity (signed httpOnly cookie) so ownership checks,
 * guardrail audit rows and history isolation still work.
 */
export const AllowAnonymous = () => SetMetadata(ANONYMOUS_KEY, true);
