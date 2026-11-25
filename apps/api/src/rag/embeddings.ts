import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import type { Env } from '../config/env';
import { EMBEDDING } from '../model-gateway/models.config';
import type { Embedder } from './ingest';

/**
 * The embedding model is fixed (PLAN §6/§7): no runtime fallback, because a
 * different model or dimension would silently break retrieval. Ingest asserts
 * the env matches the gateway config before making any provider call.
 */
export function assertEmbeddingConfig(env: Env): void {
  if (env.EMBEDDING_PROVIDER !== EMBEDDING.provider) {
    throw new Error(
      `EMBEDDING_PROVIDER=${env.EMBEDDING_PROVIDER} does not match the fixed embedding provider "${EMBEDDING.provider}".`,
    );
  }
  if (env.EMBEDDING_MODEL !== EMBEDDING.model) {
    throw new Error(
      `EMBEDDING_MODEL=${env.EMBEDDING_MODEL} does not match the fixed model "${EMBEDDING.model}".`,
    );
  }
  if (env.EMBEDDING_DIM !== EMBEDDING.dimensions) {
    throw new Error(
      `EMBEDDING_DIM=${env.EMBEDDING_DIM} does not match the fixed dimension ${EMBEDDING.dimensions}.`,
    );
  }
}

export function createGeminiEmbedder(env: Env): Embedder {
  if (!env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is required for policy ingestion (Gemini embeddings).');
  }
  const model = new GoogleGenerativeAIEmbeddings({
    apiKey: env.GOOGLE_API_KEY,
    model: env.EMBEDDING_MODEL,
    outputDimensionality: env.EMBEDDING_DIM,
  });

  return {
    async embedDocuments(texts: string[]): Promise<number[][]> {
      const vectors = await model.embedDocuments(texts);
      for (const vector of vectors) {
        if (vector.length !== env.EMBEDDING_DIM) {
          throw new Error(
            `Embedding dimension mismatch: expected ${env.EMBEDDING_DIM}, received ${vector.length}.`,
          );
        }
      }
      return vectors;
    },
  };
}
