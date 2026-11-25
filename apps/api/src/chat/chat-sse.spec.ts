import { describe, expect, it, vi } from 'vitest';
import { chunkText, openSseStream, startSseHeartbeat, writeSseText } from './chat-sse';

function fakeResponse() {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  return {
    written,
    headers,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    write: (chunk: string) => {
      written.push(chunk);
      return true;
    },
    end: vi.fn(),
    flushHeaders: vi.fn(),
    writableEnded: false,
    destroyed: false,
  };
}

describe('SSE writer', () => {
  it('sets the streaming headers and flushes them', () => {
    const res = fakeResponse();
    openSseStream(res);
    expect(res.headers).toMatchObject({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('chunks deterministically and preserves the text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    const frames = chunkText('a'.repeat(100));
    expect(frames.join('')).toHaveLength(100);
  });

  it('writes one token frame per chunk and skips ended responses', () => {
    const res = fakeResponse();
    writeSseText(res, 'hello');
    expect(res.written).toHaveLength(1);
    expect(res.written[0]).toContain('event: token');
    expect(res.written[0]).toContain('"text":"hello"');

    res.writableEnded = true;
    writeSseText(res, 'ignored');
    expect(res.written).toHaveLength(1);
  });

  it('emits keepalive pings until stopped', () => {
    vi.useFakeTimers();
    try {
      const res = fakeResponse();
      const stop = startSseHeartbeat(res, 1_000);
      vi.advanceTimersByTime(2_500);
      expect(res.written.filter((frame) => frame.includes('"type":"ping"'))).toHaveLength(2);
      stop();
      vi.advanceTimersByTime(5_000);
      expect(res.written.filter((frame) => frame.includes('"type":"ping"'))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
