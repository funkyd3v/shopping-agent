import { Injectable, Logger } from '@nestjs/common';
import { getEnv } from '../config/env';
import { RAG_POLICY } from '../guardrails/guardrails.policy';
import { ChromaPolicyStore } from './chroma.store';
import { CHUNKER_VERSION } from './chunker';
import { type PolicyRetriever, RetrievalUnavailableError, type RetrievedChunk } from './retriever';

/**
 * Runtime Chroma adapter (PLAN §7). Reads only: `getCollection` + metadata
 * assert, never `getOrCreateCollection`. A hung or down index degrades to a
 * friendly RAG message while the rest of the app keeps working.
 */
@Injectable()
export class ChromaPolicyRetriever implements PolicyRetriever {
  private readonly logger = new Logger(ChromaPolicyRetriever.name);
  private store: ChromaPolicyStore | undefined;

  async retrieve(embedding: number[], topK: number): Promise<RetrievedChunk[]> {
    const store = this.getStore();
    try {
      return await withTimeout(
        store.query(embedding, topK),
        RAG_POLICY.retrievalTimeoutMs,
        'Policy retrieval timed out',
      );
    } catch (error) {
      this.logger.warn(`policy retrieval unavailable: ${String(error)}`);
      throw new RetrievalUnavailableError(
        error instanceof Error ? error.message : 'Policy retrieval failed',
      );
    }
  }

  private getStore(): ChromaPolicyStore {
    if (this.store) return this.store;
    const env = getEnv();
    this.store = new ChromaPolicyStore({
      url: env.CHROMA_URL,
      collectionName: env.CHROMA_COLLECTION,
      embeddingModel: env.EMBEDDING_MODEL,
      embeddingDim: env.EMBEDDING_DIM,
      chunkerVersion: CHUNKER_VERSION,
    });
    return this.store;
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
