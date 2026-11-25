import { ChromaClient, ChromaNotFoundError, type Collection } from 'chromadb';
import type { EmbeddedPolicyChunk, PolicyVectorStore, StoredChunk } from './ingest';

export type ChromaPolicyStoreOptions = {
  url: string;
  collectionName: string;
  embeddingModel: string;
  embeddingDim: number;
  chunkerVersion: string;
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

  constructor(options: ChromaPolicyStoreOptions) {
    this.options = options;
    const parsed = new URL(options.url);
    const defaultPort = parsed.protocol === 'https:' ? 443 : 8000;
    this.client = new ChromaClient({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : defaultPort,
      ssl: parsed.protocol === 'https:',
    });
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

  async reset(): Promise<void> {
    try {
      await this.client.deleteCollection({ name: this.options.collectionName });
    } catch (error) {
      if (!(error instanceof ChromaNotFoundError) && !/not found|404/i.test(String(error))) {
        throw error;
      }
    }
    this.collection = undefined;
  }

  async heartbeat(): Promise<void> {
    await this.client.heartbeat();
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
}
