import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { Injectable } from '@nestjs/common';
import { getEnv } from '../config/env';
import { assertEmbeddingConfig } from './embeddings';
import type { QueryEmbedder } from './retriever';

/**
 * Query-side embeddings. The model is fixed (no fallback); dimensions are
 * checked so a provider/config drift fails loudly instead of silently
 * degrading retrieval.
 */
@Injectable()
export class GeminiQueryEmbedder implements QueryEmbedder {
  private model: GoogleGenerativeAIEmbeddings | undefined;

  async embed(text: string): Promise<number[]> {
    const env = getEnv();
    assertEmbeddingConfig(env);
    if (!env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required for policy retrieval (Gemini embeddings).');
    }
    if (!this.model) {
      this.model = new GoogleGenerativeAIEmbeddings({
        apiKey: env.GOOGLE_API_KEY,
        model: env.EMBEDDING_MODEL,
        outputDimensionality: env.EMBEDDING_DIM,
      });
    }
    const vector = await this.model.embedQuery(text);
    if (vector.length !== env.EMBEDDING_DIM) {
      throw new Error(
        `Query embedding dimension mismatch: expected ${env.EMBEDDING_DIM}, received ${vector.length}.`,
      );
    }
    return vector;
  }
}
