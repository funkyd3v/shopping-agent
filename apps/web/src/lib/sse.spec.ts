import type { SseEvent } from '@shopping-agent/shared';
import { describe, expect, it } from 'vitest';
import { readSseEvents } from './sse';

function responseFrom(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

async function collect(response: Response): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSseEvents(response)) events.push(event);
  return events;
}

describe('readSseEvents', () => {
  it('parses frames split across chunks', async () => {
    const events = await collect(
      responseFrom([
        'event: message_start\ndata: {"type":"message_start","messageId":"m1",',
        '"sessionId":"s1","runId":"r1"}\n\n',
        'event: token\ndata: {"type":"token","text":"Hel',
        'lo"}\n\n',
      ]),
    );

    expect(events).toEqual([
      { type: 'message_start', messageId: 'm1', sessionId: 's1', runId: 'r1' },
      { type: 'token', text: 'Hello' },
    ]);
  });

  it('handles CRLF, multiple data lines, pings, and a final unterminated frame', async () => {
    const events = await collect(
      responseFrom([
        'event: ping\r\ndata: {"type":"ping"}\r\n\r\n',
        'data: {"type":"done",\r\ndata: "messageId":"m1","sessionId":"s1",',
        '"runId":"r1","status":"ok"}\n\n',
        'data: {"type":"token","text":"tail"}',
      ]),
    );

    expect(events.map((event) => event.type)).toEqual(['ping', 'done', 'token']);
    expect(events[1]).toMatchObject({ type: 'done', status: 'ok' });
  });

  it('ignores malformed frames and non-data lines', async () => {
    const events = await collect(
      responseFrom([
        ': keepalive\n\n',
        'event: token\ndata: not-json\n\n',
        'event: token\ndata: {"type":"unknown"}\n\n',
        'event: token\ndata: {"type":"token","text":"ok"}\n\n',
      ]),
    );

    expect(events).toEqual([{ type: 'token', text: 'ok' }]);
  });

  it('throws when the response has no body', async () => {
    await expect(collect(new Response(null))).rejects.toThrow(/did not include a stream/);
  });
});
