import { Injectable } from '@nestjs/common';
import { getEnv } from '../config/env';
import { type ChromaHealth, checkChromaHealth } from './chroma-health';

@Injectable()
export class ChromaHealthService {
  check(): Promise<ChromaHealth> {
    const env = getEnv();
    return checkChromaHealth({
      url: env.CHROMA_URL,
      collection: env.CHROMA_COLLECTION,
      embeddingModel: env.EMBEDDING_MODEL,
      embeddingDim: env.EMBEDDING_DIM,
    });
  }
}
