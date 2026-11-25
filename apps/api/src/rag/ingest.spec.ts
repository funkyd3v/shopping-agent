import { describe, expect, it } from 'vitest';
import { type Embedder, ingestPolicies, type PolicyVectorStore, type StoredChunk } from './ingest';
import type { PolicyDocument } from './policy-loader';

const DOCS: PolicyDocument[] = [
  {
    source: 'shipping.md',
    title: 'Shipping Policy',
    markdown: '# Shipping Policy\n\n## Rates\n\nStandard shipping is $5.95.',
  },
  {
    source: 'returns.md',
    title: 'Returns Policy',
    markdown: '# Returns Policy\n\n## Window\n\nReturns are accepted within 30 days.',
  },
];

class FakeEmbedder implements Embedder {
  readonly calls: string[][] = [];

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    return texts.map((text) => [text.length, 1, 0]);
  }
}

class FakeStore implements PolicyVectorStore {
  readonly chunks = new Map<string, StoredChunk & { content: string }>();
  resetCount = 0;
  ensureCount = 0;

  async ensureCollection(): Promise<void> {
    this.ensureCount += 1;
  }

  async listChunks(): Promise<StoredChunk[]> {
    return [...this.chunks.values()].map(({ id, source, contentHash }) => ({
      id,
      source,
      contentHash,
    }));
  }

  async upsert(
    chunks: Array<{ id: string; source: string; contentHash: string; content: string }>,
  ) {
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
    }
  }

  async deleteByIds(ids: string[]): Promise<void> {
    for (const id of ids) this.chunks.delete(id);
  }

  async reset(): Promise<void> {
    this.resetCount += 1;
    this.chunks.clear();
  }
}

const baseOptions = {
  embeddingModel: 'gemini-embedding-001',
  embeddingDim: 3,
  log: () => undefined,
};

describe('policy ingest', () => {
  it('embeds on the first run and skips unchanged chunks on the second', async () => {
    const embedder = new FakeEmbedder();
    const store = new FakeStore();

    const first = await ingestPolicies({ ...baseOptions, documents: DOCS, embedder, store });
    expect(first.sources).toBe(2);
    expect(first.embedded).toBe(first.chunks);
    expect(first.skipped).toBe(0);
    expect(store.chunks.size).toBe(first.chunks);

    const callsAfterFirst = embedder.calls.length;
    const second = await ingestPolicies({ ...baseOptions, documents: DOCS, embedder, store });
    expect(second.embedded).toBe(0);
    expect(second.skipped).toBe(second.chunks);
    expect(second.deleted).toBe(0);
    expect(embedder.calls.length).toBe(callsAfterFirst);
  });

  it('re-embeds changed chunks and deletes stale ids for the source', async () => {
    const embedder = new FakeEmbedder();
    const store = new FakeStore();
    await ingestPolicies({ ...baseOptions, documents: DOCS, embedder, store });

    const updated: PolicyDocument[] = [
      DOCS[0],
      {
        source: 'returns.md',
        title: 'Returns Policy',
        markdown: '# Returns Policy\n\n## Window\n\nReturns are accepted within 45 days.',
      },
    ];
    const summary = await ingestPolicies({
      ...baseOptions,
      documents: updated,
      embedder,
      store,
    });
    expect(summary.embedded).toBeGreaterThan(0);
    const returns = [...store.chunks.values()].filter((chunk) => chunk.source === 'returns.md');
    expect(returns.some((chunk) => chunk.content.includes('45 days'))).toBe(true);
    expect(returns.some((chunk) => chunk.content.includes('30 days'))).toBe(false);
  });

  it('prunes chunks for policy documents that no longer exist', async () => {
    const embedder = new FakeEmbedder();
    const store = new FakeStore();
    await ingestPolicies({ ...baseOptions, documents: DOCS, embedder, store });

    const summary = await ingestPolicies({
      ...baseOptions,
      documents: [DOCS[0]],
      embedder,
      store,
    });
    expect(summary.prunedSources).toBe(1);
    expect([...store.chunks.values()].every((chunk) => chunk.source === 'shipping.md')).toBe(true);
  });

  it('resets the collection when requested', async () => {
    const embedder = new FakeEmbedder();
    const store = new FakeStore();
    await ingestPolicies({ ...baseOptions, documents: DOCS, embedder, store });
    await ingestPolicies({ ...baseOptions, documents: DOCS, embedder, store, reset: true });
    expect(store.resetCount).toBe(1);
  });

  it('fails loudly on an embedding dimension mismatch', async () => {
    const embedder: Embedder = { embedDocuments: async (texts) => texts.map(() => [1, 2]) };
    const store = new FakeStore();
    await expect(
      ingestPolicies({ ...baseOptions, documents: DOCS, embedder, store }),
    ).rejects.toThrow(/dimension mismatch/);
  });

  it('rejects duplicate sources', async () => {
    const embedder = new FakeEmbedder();
    const store = new FakeStore();
    await expect(
      ingestPolicies({
        ...baseOptions,
        documents: [DOCS[0], DOCS[0]],
        embedder,
        store,
      }),
    ).rejects.toThrow(/Duplicate policy source/);
  });
});
