/**
 * `pnpm rag:ingest [--reset]` — idempotent policy ingestion into Chroma.
 * Requires Chroma (pnpm docker:up) and GOOGLE_API_KEY for embeddings.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { validateEnv } from '../src/config/env';
import { ChromaPolicyStore } from '../src/rag/chroma.store';
import { CHUNKER_VERSION } from '../src/rag/chunker';
import { assertEmbeddingConfig, createGeminiEmbedder } from '../src/rag/embeddings';
import { ingestPolicies } from '../src/rag/ingest';
import { loadPolicyDocuments } from '../src/rag/policy-loader';

for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

function resolvePolicyDirectory(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../content/policies'),
    path.resolve(process.cwd(), 'content/policies'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Policy directory not found. Looked in: ${candidates.join(', ')}`);
  }
  return found;
}

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  assertEmbeddingConfig(env);
  const reset = process.argv.includes('--reset');
  const documents = loadPolicyDocuments(resolvePolicyDirectory());
  const store = new ChromaPolicyStore({
    url: env.CHROMA_URL,
    collectionName: env.CHROMA_COLLECTION,
    embeddingModel: env.EMBEDDING_MODEL,
    embeddingDim: env.EMBEDDING_DIM,
    chunkerVersion: CHUNKER_VERSION,
  });

  console.log(
    `Ingesting ${documents.length} policy documents into "${env.CHROMA_COLLECTION}" at ${env.CHROMA_URL}${reset ? ' (reset)' : ''}.`,
  );
  const summary = await ingestPolicies({
    documents,
    embedder: createGeminiEmbedder(env),
    store,
    embeddingModel: env.EMBEDDING_MODEL,
    embeddingDim: env.EMBEDDING_DIM,
    reset,
    log: (line) => console.log(`  ${line}`),
  });

  console.log(
    `Done: ${summary.sources} sources, ${summary.chunks} chunks (${summary.embedded} embedded, ${summary.skipped} unchanged, ${summary.deleted} deleted, ${summary.prunedSources} removed sources).`,
  );
}

main().catch((error: unknown) => {
  console.error('Policy ingestion failed:', error);
  process.exit(1);
});
