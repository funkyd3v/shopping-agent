import { z } from 'zod';
import { errorCodeSchema } from './errors.js';

/**
 * Server-sent events for buffered chat (PLAN §11). Every event carries a `type`
 * discriminator so the client can validate each frame with the same schema the
 * server writes against.
 *
 * `done.usage` is optional and always present for live turns; replay omits it.
 */
export const sseMessageStartSchema = z.object({
  type: z.literal('message_start'),
  messageId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
});

export const sseStatusSchema = z.object({
  type: z.literal('status'),
  phase: z.enum(['thinking', 'generating']),
});

export const sseTokenSchema = z.object({
  type: z.literal('token'),
  text: z.string(),
});

export const sseErrorSchema = z.object({
  type: z.literal('error'),
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  requestId: z.string(),
});

export const sseUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimated: z.boolean(),
});

export const sseDoneSchema = z.object({
  type: z.literal('done'),
  messageId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  status: z.enum(['ok', 'error', 'blocked']),
  usage: sseUsageSchema.optional(),
});

export const ssePingSchema = z.object({
  type: z.literal('ping'),
});

export const sseEventSchema = z.discriminatedUnion('type', [
  sseMessageStartSchema,
  sseStatusSchema,
  sseTokenSchema,
  sseErrorSchema,
  sseDoneSchema,
  ssePingSchema,
]);

export type SseEvent = z.infer<typeof sseEventSchema>;
export type SseEventType = SseEvent['type'];
export type SseUsage = z.infer<typeof sseUsageSchema>;

/**
 * Wire format: one `event:` line plus one JSON `data:` line. The event name is
 * duplicated inside `data.type` so clients can validate a frame even when an
 * intermediary drops the `event:` line.
 */
export function formatSseFrame(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Parse one `data:` payload (already JSON-decoded or raw text). */
export function parseSseEvent(value: unknown): SseEvent | null {
  let payload: unknown = value;
  if (typeof value === 'string') {
    try {
      payload = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const result = sseEventSchema.safeParse(payload);
  return result.success ? result.data : null;
}
