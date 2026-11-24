import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Request context (PLAN §18 rule 5): identity is injected from the authenticated
 * request, never from the LLM. AsyncLocalStorage makes userId/requestId
 * available to services and (later) agent tools without passing them as args.
 */
export interface RequestContext {
  requestId: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function setContextUserId(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}

export function requireRequestContext(): RequestContext {
  const store = storage.getStore();
  if (!store) throw new Error('Request context unavailable (called outside a request).');
  return store;
}

/** Runs `next()` inside a fresh context; sets/echoes x-request-id. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId =
    (typeof incoming === 'string' && incoming.length > 0 ? incoming : undefined) ??
    (typeof req.id === 'string' && req.id.length > 0 ? req.id : undefined) ??
    randomUUID();
  // Keep pino-http and our context on the same id, whichever runs first.
  req.id = requestId;
  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);
  storage.run({ requestId }, () => next());
}
