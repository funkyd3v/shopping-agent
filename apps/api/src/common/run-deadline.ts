import { getEnv } from '../config/env';

/**
 * Per-run deadline (PLAN §6). Client disconnect and timeout are combined into
 * one abort signal; `expired()` distinguishes a server-side timeout from a
 * user-initiated Stop so the SSE layer can return a friendly error instead of
 * silently ending the stream.
 */
export type RunDeadline = {
  signal: AbortSignal;
  expired: () => boolean;
};

export function runDeadlineMs(): number {
  const fromEnv = Number(process.env.RUN_DEADLINE_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  try {
    return getEnv().RUN_DEADLINE_MS;
  } catch {
    return 90_000;
  }
}

export function withRunDeadline(external: AbortSignal, timeoutMs = runDeadlineMs()): RunDeadline {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { signal: external, expired: () => false };
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  return {
    signal: AbortSignal.any([external, timeout]),
    expired: () => timeout.aborted && !external.aborted,
  };
}
