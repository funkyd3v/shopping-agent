import { describe, expect, it } from 'vitest';
import type { ChromaPolicyStoreOptions } from '../rag/chroma.store';
import { CHUNKER_VERSION } from '../rag/chunker';
import { checkChromaHealth } from './chroma-health';

const BASE = {
  url: 'http://localhost:8000',
  collection: 'store_policies',
  embeddingModel: 'gemini-embedding-001',
  embeddingDim: 768,
};

describe('checkChromaHealth', () => {
  it('reports ok with the chunk count', async () => {
    const result = await checkChromaHealth(BASE, () => ({
      health: async () => ({ chunkCount: 52 }),
    }));
    expect(result).toMatchObject({
      status: 'ok',
      collection: 'store_policies',
      chunkCount: 52,
    });
    expect(result.error).toBeUndefined();
  });

  it('reports unavailable instead of throwing when the probe fails', async () => {
    const result = await checkChromaHealth(BASE, () => ({
      health: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:8000');
      },
    }));
    expect(result.status).toBe('unavailable');
    expect(result.chunkCount).toBeNull();
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('also reports unavailability when the probe cannot be constructed', async () => {
    const result = await checkChromaHealth(BASE, () => {
      throw new Error('invalid CHROMA_URL');
    });
    expect(result.status).toBe('unavailable');
    expect(result.error).toBe('invalid CHROMA_URL');
  });

  it('truncates long errors and handles non-Error throws', async () => {
    const long = await checkChromaHealth(BASE, () => ({
      health: async () => {
        throw new Error('x'.repeat(500));
      },
    }));
    expect(long.error).toHaveLength(200);

    const weird = await checkChromaHealth(BASE, () => ({
      health: async () => {
        throw 'boom';
      },
    }));
    expect(weird.error).toBe('unknown error');
  });

  it('passes the pinned chunker version and a bounded timeout to the probe', async () => {
    let received: ChromaPolicyStoreOptions | undefined;
    await checkChromaHealth({ ...BASE, timeoutMs: 1234 }, (options) => {
      received = options;
      return { health: async () => ({ chunkCount: 0 }) };
    });
    expect(received).toMatchObject({
      collectionName: 'store_policies',
      embeddingModel: 'gemini-embedding-001',
      embeddingDim: 768,
      chunkerVersion: CHUNKER_VERSION,
      timeoutMs: 1234,
    });
  });
});
