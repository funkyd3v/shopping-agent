import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { getEnv } from '../config/env';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { RAG_POLICY } from '../guardrails/guardrails.policy';
import { ModelGatewayModule } from '../model-gateway/model-gateway.module';
import { ChromaPolicyRetriever } from './chroma.retriever';
import { GeminiQueryEmbedder } from './query-embedder';
import { RagController } from './rag.controller';
import {
  POLICY_RETRIEVER,
  QUERY_EMBEDDER,
  RAG_TUNING,
  RagService,
  type RagTuning,
} from './rag.service';

@Module({
  imports: [ModelGatewayModule, ChatModule, GuardrailsModule],
  controllers: [RagController],
  providers: [
    RagService,
    { provide: POLICY_RETRIEVER, useClass: ChromaPolicyRetriever },
    { provide: QUERY_EMBEDDER, useClass: GeminiQueryEmbedder },
    {
      provide: RAG_TUNING,
      // Env is validated before modules initialize (main.ts), so this is safe.
      useFactory: (): RagTuning => {
        const env = getEnv();
        return {
          ...RAG_POLICY,
          topK: env.RAG_TOP_K,
          maxDistance: env.RAG_MAX_DISTANCE,
        };
      },
    },
  ],
})
export class RagModule {}
