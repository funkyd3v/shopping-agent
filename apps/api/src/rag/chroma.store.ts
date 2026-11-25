import {
  ChromaClient,
  type ChromaClientArgs,
  ChromaNotFoundError,
  type Collection,
} from 'chromadb';
import type { EmbeddedPolicyChunk, PolicyVectorStore, StoredChunk } from './ingest';
import type { RetrievedChunk } from './retriever';

export type ChromaPolicyStoreOptions = {
  url: string;
  collectionName: string;
  embeddingModel: string;
  embeddingDim: number;
  chunkerVersion: string;
  /** Per-store abort deadline; set it on a single-use probe (health check). */
  timeoutMs?: number;
};

const PAGE_SIZE = 500;
const WRITE_BATCH_SIZE = 100;

/**
 * Chroma adapter for policy chunks (PLAN §7). Embeddings are always supplied
 * explicitly; the default Chroma embedding function is disabled with
 * `embeddingFunction: null`. Collection metadata pins the embedding model,
 * dimension, and chunker version so a stale index fails loudly.
 */
export class ChromaPolicyStore implements PolicyVectorStore {
  private readonly client: ChromaClient;
  private readonly options: ChromaPolicyStoreOptions;
  private collection: Collection | undefined;
  private readCollectionCache: Collection | undefined;

  constructor(options: ChromaPolicyStoreOptions) {
    this.options = options;
    const parsed = new URL(options.url);
    const defaultPort = parsed.protocol === 'https:' ? 443 : 8000;
    const clientArgs: ChromaClientArgs = {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : defaultPort,
      ssl: parsed.protocol === 'https:',
    };
    if (options.timeoutMs !== undefined) {
      // One shared deadline: a probe store is built per check and used once.
      clientArgs.fetchOptions = { signal: AbortSignal.timeout(options.timeoutMs) };
    }
    this.client = new ChromaClient(clientArgs);
  }

  async ensureCollection(): Promise<void> {
    const collection = await this.client.getOrCreateCollection({
      name: this.options.collectionName,
      configuration: { hnsw: { space: 'cosine' } },
      metadata: {
        embedding_model: this.options.embeddingModel,
        embedding_dim: this.options.embeddingDim,
        chunker_version: this.options.chunkerVersion,
        'hnsw:space': 'cosine',
      },
      embeddingFunction: null,
    });
    this.assertMetadata(collection);
    this.collection = collection;
  }

  async listChunks(): Promise<StoredChunk[]> {
    const collection = this.requireCollection();
    const chunks: StoredChunk[] = [];
    let offset = 0;
    for (;;) {
      const page = await collection.get({
        include: ['metadatas'],
        limit: PAGE_SIZE,
        offset,
      });
      const ids = page.ids ?? [];
      const metadatas = page.metadatas ?? [];
      for (const [index, id] of ids.entries()) {
        const metadata = metadatas[index] as Record<string, unknown> | null | undefined;
        const source = metadata?.source;
        const contentHash = metadata?.content_hash;
        if (typeof source === 'string' && typeof contentHash === 'string') {
          chunks.push({ id, source, contentHash });
        }
      }
      if (ids.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return chunks;
  }

  async upsert(chunks: EmbeddedPolicyChunk[]): Promise<void> {
    const collection = this.requireCollection();
    for (let start = 0; start < chunks.length; start += WRITE_BATCH_SIZE) {
      const batch = chunks.slice(start, start + WRITE_BATCH_SIZE);
      await collection.upsert({
        ids: batch.map((chunk) => chunk.id),
        embeddings: batch.map((chunk) => chunk.embedding),
        documents: batch.map((chunk) => chunk.content),
        metadatas: batch.map((chunk) => ({
          source: chunk.source,
          title: chunk.title,
          section: chunk.section,
          chunk_index: chunk.chunkIndex,
          content_hash: chunk.contentHash,
          embedding_model: this.options.embeddingModel,
          embedding_dim: this.options.embeddingDim,
          chunker_version: this.options.chunkerVersion,
        })),
      });
    }
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const collection = this.requireCollection();
    for (let start = 0; start < ids.length; start += WRITE_BATCH_SIZE) {
      await collection.delete({ ids: ids.slice(start, start + WRITE_BATCH_SIZE) });
    }
  }

  /**
   * Read-only similarity query (PLAN §7). Returns cosine **distance**:
   * 0 = identical, 2 = opposite. Callers compare against a max distance.
   */
  async query(embedding: number[], nResults: number): Promise<RetrievedChunk[]> {
    try {
      const collection = await this.readCollection();
      const result = await collection.query({
        queryEmbeddings: [embedding],
        nResults,
        include: ['documents', 'metadatas', 'distances'],
      });
      const ids = result.ids[0] ?? [];
      const documents = result.documents[0] ?? [];
      const metadatas = result.metadatas[0] ?? [];
      const distances = result.distances[0] ?? [];

      const chunks: RetrievedChunk[] = [];
      for (const [index, id] of ids.entries()) {
        const document = documents[index];
        const distance = distances[index];
        if (typeof document !== 'string' || typeof distance !== 'number') continue;
        const metadata = metadatas[index] as Record<string, unknown> | null | undefined;
        chunks.push({
          id,
          source: String(metadata?.source ?? ''),
          title: String(metadata?.title ?? ''),
          section: String(metadata?.section ?? ''),
          content: document,
          distance,
        });
      }
      return chunks.sort((a, b) => a.distance - b.distance);
    } catch (error) {
      // A failed read may be a restarted/renamed collection; re-resolve next time.
      this.readCollectionCache = undefined;
      throw error;
    }
  }

  async reset(): Promise<void> {
    try {
      await this.client.deleteCollection({ name: this.options.collectionName });
    } catch (error) {
      if (!(error instanceof ChromaNotFoundError) && !/not found|404/i.test(String(error))) {
        throw error;
      }
    }
    this.collection = undefined;
    this.readCollectionCache = undefined;
  }

  async heartbeat(): Promise<void> {
    await this.client.heartbeat();
  }

  /** Non-mutating readiness check: collection exists, metadata matches, count. */
  async health(): Promise<{ chunkCount: number }> {
    const collection = await this.client.getCollection({ name: this.options.collectionName });
    this.assertMetadata(collection);
    return { chunkCount: await collection.count() };
  }

  private assertMetadata(collection: Collection): void {
    const metadata = (collection.metadata ?? {}) as Record<string, unknown>;
    const actualModel = metadata.embedding_model;
    const actualDim = Number(metadata.embedding_dim);
    const actualChunker = metadata.chunker_version;
    if (
      actualModel !== this.options.embeddingModel ||
      actualDim !== this.options.embeddingDim ||
      actualChunker !== this.options.chunkerVersion
    ) {
      throw new Error(
        `Chroma collection "${this.options.collectionName}" uses embedding_model=${String(actualModel)}, embedding_dim=${String(actualDim)}, chunker_version=${String(actualChunker)}; expected ${this.options.embeddingModel}/${this.options.embeddingDim}/${this.options.chunkerVersion}. Run "pnpm rag:ingest:reset" to rebuild the index.`,
      );
    }
  }

  private requireCollection(): Collection {
    if (!this.collection) {
      throw new Error('Chroma collection is not initialized; call ensureCollection() first.');
    }
    return this.collection;
  }

  /** Reuse a read handle, but never create/mutate the collection from a query. */
  private async readCollection(): Promise<Collection> {
    if (this.readCollectionCache) return this.readCollectionCache;
    const collection = await this.client.getCollection({ name: this.options.collectionName });
    this.assertMetadata(collection);
    this.readCollectionCache = collection;
    return collection;
  }
}
