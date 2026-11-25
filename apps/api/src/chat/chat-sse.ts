import type { SseEvent } from '@shopping-agent/shared';
import { formatSseFrame } from '@shopping-agent/shared';

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

export const SSE_HEARTBEAT_MS = 15_000;
export const SSE_TOKEN_CHUNK_CHARS = 48;

/** Minimal response surface so the writer is unit-testable without a socket. */
export type SseResponse = {
  write(chunk: string): unknown;
  end(): unknown;
  setHeader(name: string, value: string): unknown;
  flushHeaders?: () => void;
  writableEnded?: boolean;
  destroyed?: boolean;
};

/** Set SSE headers and flush so the client sees `message_start` immediately. */
export function openSseStream(res: SseResponse): void {
  for (const [name, value] of Object.entries(SSE_HEADERS)) {
    res.setHeader(name, value);
  }
  res.flushHeaders?.();
}

export function writeSseEvent(res: SseResponse, event: SseEvent): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(formatSseFrame(event));
}

/** Keepalive frames while the model works (buffered mode can be slow). */
export function startSseHeartbeat(
  res: SseResponse,
  intervalMs: number = SSE_HEARTBEAT_MS,
): () => void {
  const timer = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) writeSseEvent(res, { type: 'ping' });
  }, intervalMs);
  // Do not keep a background test/process alive because of a heartbeat.
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Split text into deterministic token frames; concatenation equals the input. */
export function chunkText(text: string, size: number = SSE_TOKEN_CHUNK_CHARS): string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    chunks.push(text.slice(start, start + size));
  }
  return chunks;
}

export function writeSseText(res: SseResponse, text: string): void {
  for (const chunk of chunkText(text)) {
    writeSseEvent(res, { type: 'token', text: chunk });
  }
}
