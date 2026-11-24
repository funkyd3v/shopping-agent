import type { Response } from 'express';

export const AUTH_COOKIE = 'access_token';

/** Set the JWT as an httpOnly cookie. Never expose it in the response body. */
export function setAuthCookie(res: Response, token: string, maxAgeSec: number): void {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSec * 1000,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
}
