import { z } from 'zod';
import type { RetrievedChunk } from './retriever';

/**
 * RAG eval plumbing (PLAN §7/§10.5): retrieval hit-rate@k plus deterministic
 * fact checks. The dataset lives in `evals/rag/policy-questions.json`; the live
 * runner (`pnpm eval:rag`) injects real Chroma/embeddings/models, while unit
 * tests inject fakes and need no network.
 */
export const ragEvalQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expected: z.array(z.object({ source: z.string().min(1), section: z.string().min(1) })).min(1),
  facts: z.array(z.string().min(1)).min(1),
});

export const ragEvalDatasetSchema = z.object({
  version: z.literal(1),
  questions: z.array(ragEvalQuestionSchema).min(1),
  outOfScope: z.array(z.object({ id: z.string(), question: z.string() })).default([]),
  noMatch: z.array(z.object({ id: z.string(), question: z.string() })).default([]),
});

export type RagEvalQuestion = z.infer<typeof ragEvalQuestionSchema>;
export type RagEvalDataset = z.infer<typeof ragEvalDatasetSchema>;

export type RagEvalQuestionResult = {
  id: string;
  question: string;
  hit: boolean;
  /** 1-based rank of the first expected section, or null. */
  rank: number | null;
  factsPass: boolean;
  missingFacts: string[];
  answered: boolean;
  answer?: string;
  error?: string;
};

export type RagEvalSummary = {
  topK: number;
  results: RagEvalQuestionResult[];
  hitRate: number;
  factPassRate: number | null;
  allPassed: boolean;
};

export type RagEvalOptions = {
  dataset: RagEvalDataset;
  topK: number;
  /** Return the raw top-k chunks (distance included) for a question. */
  retrieve: (question: string) => Promise<RetrievedChunk[]>;
  /** Optional: produce a grounded answer for fact checks. */
  answer?: (question: string, chunks: RetrievedChunk[]) => Promise<string>;
  /** Only chunks at or below this cosine distance are given to the answerer. */
  maxDistance?: number;
};

export async function runRagEval(options: RagEvalOptions): Promise<RagEvalSummary> {
  const results: RagEvalQuestionResult[] = [];

  for (const question of options.dataset.questions) {
    const result: RagEvalQuestionResult = {
      id: question.id,
      question: question.question,
      hit: false,
      rank: null,
      factsPass: false,
      missingFacts: question.facts,
      answered: false,
    };

    try {
      const chunks = (await options.retrieve(question.question)).slice(0, options.topK);
      const rank = findExpectedRank(chunks, question);
      result.hit = rank !== null;
      result.rank = rank;

      if (options.answer) {
        const relevant =
          options.maxDistance === undefined
            ? chunks
            : chunks.filter((chunk) => chunk.distance <= (options.maxDistance as number));
        if (relevant.length > 0) {
          const answer = await options.answer(question.question, relevant);
          result.answered = true;
          result.answer = answer;
          const normalized = normalizeForFacts(answer);
          const missing = question.facts.filter((fact) => !safeRegex(fact).test(normalized));
          result.missingFacts = missing;
          result.factsPass = missing.length === 0;
        } else {
          result.answered = true;
          result.answer = '';
        }
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    results.push(result);
  }

  const total = results.length;
  const hits = results.filter((result) => result.hit).length;
  const answered = results.filter((result) => result.answered);
  const factsPassed = answered.filter((result) => result.factsPass).length;
  // `--retrieval-only` omits the answerer, so it gates on retrieval alone. A
  // full run must also answer every question with all expected facts present.
  const allPassed =
    hits === total &&
    (options.answer === undefined || (answered.length === total && factsPassed === total));

  return {
    topK: options.topK,
    results,
    hitRate: total === 0 ? 0 : hits / total,
    factPassRate: answered.length === 0 ? null : factsPassed / answered.length,
    allPassed,
  };
}

export function findExpectedRank(
  chunks: RetrievedChunk[],
  question: RagEvalQuestion,
): number | null {
  for (const [index, chunk] of chunks.entries()) {
    const matched = question.expected.some(
      (expected) => expected.source === chunk.source && expected.section === chunk.section,
    );
    if (matched) return index + 1;
  }
  return null;
}

/**
 * Models render ranges and compounds with typographic punctuation (`12‑month`,
 * `3–5 business days`, non-breaking spaces). Normalize those to ASCII before
 * deterministic fact checks so a faithfully quoted number still passes.
 */
export function normalizeForFacts(text: string): string {
  return text
    .replace(/[\u2010-\u2015\u2212\u00ad]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"');
}

function safeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    // A bad dataset entry should fail the check, not crash the runner.
    return /(?!)/;
  }
}
