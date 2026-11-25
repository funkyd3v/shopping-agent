import {
  chunkPolicy,
  DEFAULT_MAX_CHARS,
  DEFAULT_OVERLAP_CHARS,
  embeddingText,
  type PolicyChunk,
} from './chunker';
import type { PolicyDocument } from './policy-loader';

export type Embedder = {
  embedDocuments(texts: string[]): Promise<number[][]>;
};

export type StoredChunk = {
  id: string;
  source: string;
  contentHash: string;
};

export type EmbeddedPolicyChunk = PolicyChunk & { embedding: number[] };

/**
 * Narrow vector-store port so ingest can be unit-tested without Chroma.
 * Implementations must treat `upsert` as idempotent by chunk id.
 */
export type PolicyVectorStore = {
  ensureCollection(): Promise<void>;
  listChunks(): Promise<StoredChunk[]>;
  upsert(chunks: EmbeddedPolicyChunk[]): Promise<void>;
  deleteByIds(ids: string[]): Promise<void>;
  reset(): Promise<void>;
};

export type IngestOptions = {
  documents: PolicyDocument[];
  embedder: Embedder;
  store: PolicyVectorStore;
  embeddingModel: string;
  embeddingDim: number;
  maxChars?: number;
  overlapChars?: number;
  reset?: boolean;
  log?: (line: string) => void;
};

export type IngestSummary = {
  sources: number;
  chunks: number;
  embedded: number;
  skipped: number;
  deleted: number;
  prunedSources: number;
};

const EMBED_BATCH_SIZE = 64;

/**
 * Idempotent policy ingest (PLAN §7): skip unchanged chunks, re-embed changed
 * ones, delete stale ids for a source, and prune documents that no longer
 * exist. Re-running with no content changes makes no embedding calls.
 */
export async function ingestPolicies(options: IngestOptions): Promise<IngestSummary> {
  const log = options.log ?? (() => undefined);
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const sources = new Set<string>();
  for (const document of options.documents) {
    if (sources.has(document.source)) {
      throw new Error(`Duplicate policy source: ${document.source}`);
    }
    sources.add(document.source);
  }

  if (options.reset) {
    log('Resetting the policy collection.');
    await options.store.reset();
  }
  await options.store.ensureCollection();

  const chunksBySource = new Map<string, PolicyChunk[]>();
  for (const document of options.documents) {
    chunksBySource.set(document.source, chunkPolicy(document, { maxChars, overlapChars }));
  }

  const existing = await options.store.listChunks();
  const existingBySource = new Map<string, StoredChunk[]>();
  for (const chunk of existing) {
    const list = existingBySource.get(chunk.source) ?? [];
    list.push(chunk);
    existingBySource.set(chunk.source, list);
  }

  const summary: IngestSummary = {
    sources: options.documents.length,
    chunks: 0,
    embedded: 0,
    skipped: 0,
    deleted: 0,
    prunedSources: 0,
  };

  for (const [source, chunks] of chunksBySource) {
    summary.chunks += chunks.length;
    const current = existingBySource.get(source) ?? [];
    const currentById = new Map(current.map((chunk) => [chunk.id, chunk]));
    const nextIds = new Set(chunks.map((chunk) => chunk.id));

    const staleIds = current.filter((chunk) => !nextIds.has(chunk.id)).map((chunk) => chunk.id);
    const changed = chunks.filter((chunk) => {
      const previous = currentById.get(chunk.id);
      return !previous || previous.contentHash !== chunk.contentHash;
    });

    if (staleIds.length === 0 && changed.length === 0) {
      summary.skipped += chunks.length;
      log(`${source}: unchanged (${chunks.length} chunks).`);
      continue;
    }

    if (staleIds.length > 0) {
      await options.store.deleteByIds(staleIds);
      summary.deleted += staleIds.length;
    }

    if (changed.length > 0) {
      const embedded = await embedChunks(changed, options.embedder, options.embeddingDim);
      await options.store.upsert(embedded);
      summary.embedded += embedded.length;
    }

    log(
      `${source}: ${chunks.length} chunks, ${changed.length} embedded, ${staleIds.length} deleted.`,
    );
  }

  for (const [source, current] of existingBySource) {
    if (sources.has(source)) continue;
    const ids = current.map((chunk) => chunk.id);
    if (ids.length === 0) continue;
    await options.store.deleteByIds(ids);
    summary.deleted += ids.length;
    summary.prunedSources += 1;
    log(`${source}: removed (${ids.length} stale chunks).`);
  }

  return summary;
}

async function embedChunks(
  chunks: PolicyChunk[],
  embedder: Embedder,
  embeddingDim: number,
): Promise<EmbeddedPolicyChunk[]> {
  const embedded: EmbeddedPolicyChunk[] = [];
  for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
    const vectors = await embedder.embedDocuments(batch.map(embeddingText));
    if (vectors.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch: expected ${batch.length}, received ${vectors.length}.`,
      );
    }
    for (const [index, vector] of vectors.entries()) {
      if (vector.length !== embeddingDim) {
        throw new Error(
          `Embedding dimension mismatch: expected ${embeddingDim}, received ${vector.length}. Re-index with the configured model.`,
        );
      }
      embedded.push({ ...batch[index], embedding: vector });
    }
  }
  return embedded;
}
