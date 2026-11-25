import { parseSseEvent, type SseEvent } from '@shopping-agent/shared';

/**
 * Read an SSE response body and yield validated events (PLAN §11). The server
 * writes one `event:` line plus one JSON `data:` line per frame; frames are
 * separated by a blank line and may be split across network chunks.
 */
export async function* readSseEvents(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) throw new Error('The response did not include a stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(block);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }

    // A final frame without the trailing blank line.
    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(block: string): SseEvent | null {
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return parseSseEvent(dataLines.join('\n'));
}
