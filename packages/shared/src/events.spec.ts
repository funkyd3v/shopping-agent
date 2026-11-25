import { describe, expect, it } from 'vitest';
import {
  chatRequestSchema,
  chatSessionsQuerySchema,
  formatSseFrame,
  parseSseEvent,
  sseEventSchema,
} from './index.js';

describe('SSE contracts', () => {
  it('validates every event type', () => {
    const events = [
      {
        type: 'message_start',
        messageId: 'msg_1',
        sessionId: 'ses_1',
        runId: 'run_1',
      },
      { type: 'status', phase: 'thinking' },
      { type: 'token', text: 'hello' },
      {
        type: 'error',
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Try again.',
        retryable: true,
        requestId: 'req_1',
      },
      {
        type: 'done',
        messageId: 'msg_1',
        sessionId: 'ses_1',
        runId: 'run_1',
        status: 'ok',
        usage: { inputTokens: 10, outputTokens: 20, estimated: true },
      },
      { type: 'ping' },
    ];

    for (const event of events) {
      expect(sseEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('rejects unknown event types and statuses', () => {
    expect(sseEventSchema.safeParse({ type: 'trace', data: {} }).success).toBe(false);
    expect(sseEventSchema.safeParse({ type: 'status', phase: 'done' }).success).toBe(false);
    expect(
      sseEventSchema.safeParse({
        type: 'error',
        code: 'NOT_A_CODE',
        message: 'x',
        retryable: false,
        requestId: 'r',
      }).success,
    ).toBe(false);
  });

  it('formats a frame with both the event name and JSON data', () => {
    const frame = formatSseFrame({ type: 'token', text: 'hi' });
    expect(frame).toBe('event: token\ndata: {"type":"token","text":"hi"}\n\n');
  });

  it('parses valid JSON and rejects malformed payloads', () => {
    expect(parseSseEvent('{"type":"ping"}')).toEqual({ type: 'ping' });
    expect(parseSseEvent('not json')).toBeNull();
    expect(parseSseEvent({ type: 'unknown' })).toBeNull();
  });
});

describe('chat request DTO', () => {
  const valid = {
    clientMessageId: '3f0a6c2e-1d4b-4c8f-9d2a-7b6e5c4d3a21',
    message: 'How long does standard shipping take?',
  };

  it('accepts a minimal request and trims the message', () => {
    const parsed = chatRequestSchema.parse({ ...valid, message: '  hello  ' });
    expect(parsed.message).toBe('hello');
    expect(parsed.sessionId).toBeUndefined();
  });

  it('rejects missing ids, short ids, unsafe ids, empty and oversized messages', () => {
    expect(chatRequestSchema.safeParse({ message: 'hi' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...valid, clientMessageId: 'short' }).success).toBe(false);
    expect(
      chatRequestSchema.safeParse({ ...valid, clientMessageId: 'has spaces here' }).success,
    ).toBe(false);
    expect(chatRequestSchema.safeParse({ ...valid, message: '   ' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...valid, message: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });
});

describe('sessions query DTO', () => {
  it('defaults the limit and normalizes kind', () => {
    expect(chatSessionsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(chatSessionsQuerySchema.parse({ kind: 'rag', limit: '5' })).toEqual({
      kind: 'rag',
      limit: 5,
    });
  });

  it('rejects unknown kinds and oversized limits', () => {
    expect(chatSessionsQuerySchema.safeParse({ kind: 'admin' }).success).toBe(false);
    expect(chatSessionsQuerySchema.safeParse({ limit: 5000 }).success).toBe(false);
  });
});
