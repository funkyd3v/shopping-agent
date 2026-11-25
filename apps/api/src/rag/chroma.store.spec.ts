import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChromaPolicyStore } from './chroma.store';
import { CHUNKER_VERSION } from './chunker';

/**
 * The Chroma adapter is tested against a mocked client: no Docker container,
 * network, or API key is required. These specs pin the non-mutating health
 * probe and the stale-index guard.
 */
const mocks = vi.hoisted(() => ({
  clientArgs: [] as unknown[],
  getCollection: vi.fn(),
  getOrCreateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  heartbeat: vi.fn(),
  query: vi.fn(),
}));

vi.mock('chromadb', () => ({
  ChromaClient: class {
    constructor(args: unknown) {
      mocks.clientArgs.push(args);
    }
    getCollection = mocks.getCollection;
    getOrCreateCollection = mocks.getOrCreateCollection;
    deleteCollection = mocks.deleteCollection;
    heartbeat = mocks.heartbeat;
  },
  ChromaNotFoundError: class ChromaNotFoundError extends Error {},
}));

const OPTIONS = {
  url: 'http://127.0.0.1:8000',
  collectionName: 'store_policies',
  embeddingModel: 'gemini-embedding-001',
  embeddingDim: 768,
  chunkerVersion: CHUNKER_VERSION,
};

const METADATA = {
  embedding_model: 'gemini-embedding-001',
  embedding_dim: 768,
  chunker_version: CHUNKER_VERSION,
  'hnsw:space': 'cosine',
};

const collection = (metadata: Record<string, unknown> = METADATA, count = 52) => ({
  metadata,
  count: async () => count,
  query: mocks.query,
});

describe('ChromaPolicyStore.health', () => {
  beforeEach(() => {
    mocks.clientArgs.length = 0;
    vi.clearAllMocks();
  });

  it('reads an existing collection and returns its chunk count', async () => {
    mocks.getCollection.mockResolvedValue(collection());
    const store = new ChromaPolicyStore(OPTIONS);

    await expect(store.health()).resolves.toEqual({ chunkCount: 52 });

    expect(mocks.getCollection).toHaveBeenCalledWith({ name: 'store_policies' });
    expect(mocks.getOrCreateCollection).not.toHaveBeenCalled();
    expect(mocks.heartbeat).not.toHaveBeenCalled();
  });

  it('fails loudly when the collection metadata no longer matches env', async () => {
    mocks.getCollection.mockResolvedValue(
      collection({ ...METADATA, embedding_dim: 1536, embedding_model: 'other-model' }),
    );
    const store = new ChromaPolicyStore(OPTIONS);

    await expect(store.health()).rejects.toThrow(/rag:ingest:reset/);
  });

  it('does not create the collection when it is missing', async () => {
    mocks.getCollection.mockRejectedValue(new Error('Collection store_policies does not exist'));
    const store = new ChromaPolicyStore(OPTIONS);

    await expect(store.health()).rejects.toThrow(/does not exist/);
    expect(mocks.getOrCreateCollection).not.toHaveBeenCalled();
  });

  it('applies a bounded abort deadline only when a timeout is requested', () => {
    new ChromaPolicyStore(OPTIONS);
    expect(mocks.clientArgs[0]).not.toHaveProperty('fetchOptions');

    new ChromaPolicyStore({ ...OPTIONS, timeoutMs: 2_000 });
    expect(mocks.clientArgs[1]).toMatchObject({
      host: '127.0.0.1',
      port: 8000,
      ssl: false,
      fetchOptions: { signal: expect.any(AbortSignal) },
    });
  });
});

describe('ChromaPolicyStore.query', () => {
  beforeEach(() => {
    mocks.clientArgs.length = 0;
    vi.clearAllMocks();
  });

  it('returns chunks sorted by cosine distance using read-only access', async () => {
    mocks.getCollection.mockResolvedValue(collection());
    mocks.query.mockResolvedValue({
      ids: [['chunk_b', 'chunk_a']],
      documents: [['FAQ text', 'Shipping text']],
      metadatas: [
        [
          { source: 'faq.md', title: 'FAQ', section: 'Shipping' },
          { source: 'shipping.md', title: 'Shipping Policy', section: 'Rates' },
        ],
      ],
      distances: [[0.3, 0.1]],
    });

    const store = new ChromaPolicyStore(OPTIONS);
    await expect(store.query([0.1, 0.2], 5)).resolves.toEqual([
      {
        id: 'chunk_a',
        source: 'shipping.md',
        title: 'Shipping Policy',
        section: 'Rates',
        content: 'Shipping text',
        distance: 0.1,
      },
      {
        id: 'chunk_b',
        source: 'faq.md',
        title: 'FAQ',
        section: 'Shipping',
        content: 'FAQ text',
        distance: 0.3,
      },
    ]);
    expect(mocks.query).toHaveBeenCalledWith({
      queryEmbeddings: [[0.1, 0.2]],
      nResults: 5,
      include: ['documents', 'metadatas', 'distances'],
    });
    expect(mocks.getOrCreateCollection).not.toHaveBeenCalled();
  });

  it('skips incomplete rows and re-resolves the collection after a failed read', async () => {
    mocks.getCollection.mockResolvedValue(collection());
    mocks.query.mockResolvedValueOnce({
      ids: [['missing_doc', 'missing_distance', 'ok']],
      documents: [[null, 'doc', 'valid']],
      metadatas: [[null, null, null]],
      distances: [[0.1, null, 0.2]],
    });

    const store = new ChromaPolicyStore(OPTIONS);
    await expect(store.query([0.1], 3)).resolves.toEqual([
      { id: 'ok', source: '', title: '', section: '', content: 'valid', distance: 0.2 },
    ]);

    mocks.query.mockRejectedValueOnce(new Error('collection restarted'));
    await expect(store.query([0.1], 3)).rejects.toThrow('collection restarted');

    mocks.query.mockResolvedValueOnce({
      ids: [['ok']],
      documents: [['valid']],
      metadatas: [[null]],
      distances: [[0.2]],
    });
    await expect(store.query([0.1], 3)).resolves.toHaveLength(1);
    expect(mocks.getCollection).toHaveBeenCalledTimes(2);
  });
});
