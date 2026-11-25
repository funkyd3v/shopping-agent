import { z } from 'zod';

/** Chat session kinds (PLAN §5/§13). An endpoint only accepts its own kind. */
export const CHAT_SESSION_KINDS = ['rag', 'agent'] as const;
export const chatSessionKindSchema = z.enum(CHAT_SESSION_KINDS);
export type ChatSessionKind = z.infer<typeof chatSessionKindSchema>;

export const chatSessionIdSchema = z.string().trim().min(1).max(60);

export const chatClientMessageIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'clientMessageId must be URL-safe');

/**
 * `POST /rag/chat` and `POST /agent/chat` body (PLAN §11.3).
 * `max(2000)` mirrors the default MAX_MESSAGE_CHARS; the server also enforces env.
 */
export const chatRequestSchema = z.object({
  sessionId: chatSessionIdSchema.optional(),
  clientMessageId: chatClientMessageIdSchema,
  message: z.string().trim().min(1).max(2000),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** A retrieved policy section shown under an answer as plain text. */
export const chatSourceSchema = z.object({
  source: z.string(),
  title: z.string(),
  section: z.string(),
});

export type ChatSource = z.infer<typeof chatSourceSchema>;

export const chatSessionSummarySchema = z.object({
  id: z.string(),
  kind: chatSessionKindSchema,
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ChatSessionSummary = z.infer<typeof chatSessionSummarySchema>;

export const chatSessionListSchema = z.object({
  sessions: z.array(chatSessionSummarySchema),
});

export type ChatSessionList = z.infer<typeof chatSessionListSchema>;

export const chatMessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);

/** Stored turn as returned by `GET /sessions/:id/messages`. */
export const chatMessageSchema = z.object({
  id: z.string(),
  role: chatMessageRoleSchema,
  content: z.string(),
  status: z.enum(['complete', 'error']),
  createdAt: z.string(),
  sources: z.array(chatSourceSchema).optional(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatMessagesResponseSchema = z.object({
  sessionId: z.string(),
  messages: z.array(chatMessageSchema),
});

export type ChatMessagesResponse = z.infer<typeof chatMessagesResponseSchema>;

export const chatSessionsQuerySchema = z.object({
  kind: chatSessionKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ChatSessionsQuery = z.infer<typeof chatSessionsQuerySchema>;

/**
 * Links allowed in chat text (PLAN §10.3/§12.2). Relative links must point at
 * known store routes; external links must be https. `javascript:`/`data:` and
 * protocol-relative URLs are rejected.
 */
export function isSafeChatHref(href: string): boolean {
  const value = href.trim();
  if (value.length === 0) return false;
  if (value.startsWith('//')) return false;
  if (value.startsWith('/')) {
    return /^\/(?:products\/[^/\s?#]+|cart(?:\?[^\s#]*)?|orders\/[^/\s?#]+|help|assistant)$/.test(
      value,
    );
  }
  return /^https:\/\/[^\s]+$/i.test(value) && !/\p{Cc}/u.test(value);
}
