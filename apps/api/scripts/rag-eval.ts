/**
 * `pnpm eval:rag [--json] [--retrieval-only]` — live RAG quality gate.
 *
 * Checks three things against the real Chroma index, embeddings, and models:
 * 1. retrieval hit-rate@k for in-scope policy questions;
 * 2. deterministic fact presence in grounded answers (when not retrieval-only);
 * 3. out-of-scope questions redirect, and no-match questions return no chunk
 *    inside RAG_MAX_DISTANCE.
 *
 * Requires Chroma (`pnpm docker:up`), GOOGLE_API_KEY, and a provider key.
 * Never used by unit tests; the runner is covered with fakes in eval.spec.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { validateEnv } from '../src/config/env';
import { RAG_COPY, RAG_POLICY } from '../src/guardrails/guardrails.policy';
import { CassetteStore } from '../src/model-gateway/cassette.store';
import { ModelGatewayService } from '../src/model-gateway/model-gateway.service';
import { ChromaPolicyStore } from '../src/rag/chroma.store';
import { CHUNKER_VERSION } from '../src/rag/chunker';
import { assertEmbeddingConfig } from '../src/rag/embeddings';
import { type RagEvalQuestionResult, ragEvalDatasetSchema, runRagEval } from '../src/rag/eval';
import { buildAnswerMessages } from '../src/rag/prompt';
import { GeminiQueryEmbedder } from '../src/rag/query-embedder';
import type { RetrievedChunk } from '../src/rag/retriever';
import { buildScopeClassifierMessages, resolveScope } from '../src/rag/scope';

for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

function resolveDatasetPath(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../evals/rag/policy-questions.json'),
    path.resolve(process.cwd(), 'evals/rag/policy-questions.json'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Eval dataset not found. Looked in: ${candidates.join(', ')}`);
  }
  return found;
}

function printTable(rows: string[][]): void {
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  );
  for (const [index, row] of rows.entries()) {
    const line = row.map((cell, column) => (cell ?? '').padEnd(widths[column])).join('  ');
    console.log(line);
    if (index === 0) console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  }
}

function formatQuestion(result: RagEvalQuestionResult): string[] {
  if (result.error) return [result.id, 'ERR', '-', result.error.slice(0, 60)];
  const rank = result.rank === null ? 'miss' : `#${result.rank}`;
  const facts = result.answered ? (result.factsPass ? 'pass' : 'FAIL') : 'n/a';
  const missing = result.missingFacts.length > 0 ? result.missingFacts.join(',') : '';
  return [result.id, rank, facts, missing.slice(0, 60)];
}

async function main(): Promise<void> {
  const json = process.argv.includes('--json');
  const retrievalOnly = process.argv.includes('--retrieval-only');
  const env = validateEnv(process.env);
  assertEmbeddingConfig(env);

  if (!env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is required for the RAG eval (query embeddings).');
  }

  const dataset = ragEvalDatasetSchema.parse(
    JSON.parse(fs.readFileSync(resolveDatasetPath(), 'utf8')) as unknown,
  );

  const store = new ChromaPolicyStore({
    url: env.CHROMA_URL,
    collectionName: env.CHROMA_COLLECTION,
    embeddingModel: env.EMBEDDING_MODEL,
    embeddingDim: env.EMBEDDING_DIM,
    chunkerVersion: CHUNKER_VERSION,
  });
  const embedder = new GeminiQueryEmbedder();
  const gateway = new ModelGatewayService(new CassetteStore());

  const retrieve = async (question: string): Promise<RetrievedChunk[]> => {
    const vector = await embedder.embed(question);
    return store.query(vector, env.RAG_TOP_K);
  };

  const answer = retrievalOnly
    ? undefined
    : async (question: string, chunks: RetrievedChunk[]): Promise<string> => {
        const result = await gateway.generate({
          chain: 'rag',
          messages: buildAnswerMessages(question, chunks),
          temperature: RAG_POLICY.temperature,
        });
        return result.content;
      };

  const summary = await runRagEval({
    dataset,
    topK: env.RAG_TOP_K,
    maxDistance: env.RAG_MAX_DISTANCE,
    retrieve,
    answer,
  });

  const scopeResults = [];
  for (const item of dataset.outOfScope) {
    const scope = await resolveScope(item.question, {
      minConfidence: RAG_POLICY.scopeMinConfidence,
      classify: async (question) => {
        const result = await gateway.generate({
          chain: 'guardrail',
          messages: buildScopeClassifierMessages(question),
          temperature: 0,
        });
        return result.content;
      },
    });
    scopeResults.push({ id: item.id, question: item.question, passed: scope.scope === 'out' });
  }

  const noMatchResults = [];
  for (const item of dataset.noMatch) {
    const chunks = await retrieve(item.question);
    const relevant = chunks.filter((chunk) => chunk.distance <= env.RAG_MAX_DISTANCE);
    noMatchResults.push({
      id: item.id,
      question: item.question,
      passed: relevant.length === 0,
      bestDistance: chunks[0]?.distance ?? null,
      answer: RAG_COPY.noMatch,
    });
  }

  const passed =
    summary.allPassed &&
    scopeResults.every((result) => result.passed) &&
    noMatchResults.every((result) => result.passed);

  if (json) {
    console.log(
      JSON.stringify(
        {
          dataset: resolveDatasetPath(),
          topK: env.RAG_TOP_K,
          maxDistance: env.RAG_MAX_DISTANCE,
          summary,
          scope: scopeResults,
          noMatch: noMatchResults,
          passed,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `RAG eval: ${dataset.questions.length} in-scope, ${scopeResults.length} out-of-scope, ${noMatchResults.length} no-match`,
    );
    console.log(`topK=${env.RAG_TOP_K} maxDistance=${env.RAG_MAX_DISTANCE}\n`);
    printTable([['question', 'rank', 'facts', 'missing'], ...summary.results.map(formatQuestion)]);
    console.log(
      `\nretrieval hit-rate: ${(summary.hitRate * 100).toFixed(1)}% (${summary.results.filter((result) => result.hit).length}/${summary.results.length})`,
    );
    if (summary.factPassRate !== null) {
      console.log(`fact pass-rate: ${(summary.factPassRate * 100).toFixed(1)}%`);
    }
    for (const result of scopeResults) {
      console.log(`scope ${result.passed ? 'pass' : 'FAIL'} ${result.id}`);
    }
    for (const result of noMatchResults) {
      console.log(
        `no-match ${result.passed ? 'pass' : 'FAIL'} ${result.id} (best distance ${result.bestDistance ?? 'n/a'})`,
      );
    }
    console.log(`\n${passed ? 'PASS' : 'FAIL'}`);
  }

  if (!passed && !process.argv.includes('--no-fail')) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('RAG eval failed:', error);
  process.exit(1);
});
