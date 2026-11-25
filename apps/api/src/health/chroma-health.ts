import { ChromaPolicyStore, type ChromaPolicyStoreOptions } from '../rag/chroma.store';
import { CHUNKER_VERSION } from '../rag/chunker';

export type ChromaHealth = {
  status: 'ok' | 'unavailable';
  collection: string;
  chunkCount: number | null;
  latencyMs: number;
  error?: string;
};

export type ChromaHealthOptions = {
  url: string;
  collection: string;
  embeddingModel: string;
  embeddingDim: number;
  timeoutMs?: number;
};

type ChromaHealthProbe = {
  health(): Promise<{ chunkCount: number }>;
};

const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * Read-only Chroma readiness probe. It never throws and never creates the
 * collection, so a missing/broken index is reported instead of repaired. The
 * response carries no credentials; Chroma binds to localhost (PLAN §15).
 */
export async function checkChromaHealth(
  options: ChromaHealthOptions,
  createProbe: (storeOptions: ChromaPolicyStoreOptions) => ChromaHealthProbe = (storeOptions) =>
    new ChromaPolicyStore(storeOptions),
): Promise<ChromaHealth> {
  const startedAt = Date.now();
  try {
    const probe = createProbe({
      url: options.url,
      collectionName: options.collection,
      embeddingModel: options.embeddingModel,
      embeddingDim: options.embeddingDim,
      chunkerVersion: CHUNKER_VERSION,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const { chunkCount } = await probe.health();
    return {
      status: 'ok',
      collection: options.collection,
      chunkCount,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      collection: options.collection,
      chunkCount: null,
      latencyMs: Date.now() - startedAt,
      error: safeErrorMessage(error),
    };
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message.length > 200 ? `${message.slice(0, 199)}…` : message;
}
