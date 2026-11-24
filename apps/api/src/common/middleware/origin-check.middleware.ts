import type { NextFunction, Request, Response } from 'express';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF hardening for cookie auth (PLAN §13): state-changing requests must come
 * from an allowed origin. Non-browser clients (curl, tests) send no Origin and
 * are allowed; browsers must match WEB_ORIGIN or the API's own origin.
 */
export function originCheckMiddleware(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!MUTATING.has(req.method)) {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (origin === undefined || allowed.has(origin)) {
      next();
      return;
    }
    res.status(403).json({ code: 'ORIGIN_FORBIDDEN', message: 'Request origin not allowed.' });
  };
}
