import { describe, expect, it } from 'vitest';
import {
  findExpectedRank,
  normalizeForFacts,
  type RagEvalDataset,
  ragEvalDatasetSchema,
  runRagEval,
} from './eval';
import type { RetrievedChunk } from './retriever';

const chunk = (source: string, section: string): RetrievedChunk => ({
  id: `${source}:${section}`,
  source,
  title: source,
  section,
  content: 'text',
  distance: 0.1,
});

const dataset: RagEvalDataset = {
  version: 1,
  questions: [
    {
      id: 'shipping',
      question: 'How much is shipping?',
      expected: [{ source: 'shipping.md', section: 'Rates' }],
      facts: ['\\$5\\.95'],
    },
    {
      id: 'returns',
      question: 'What is the return window?',
      expected: [{ source: 'returns.md', section: 'Window' }],
      facts: ['30\\s*days'],
    },
  ],
  outOfScope: [],
  noMatch: [],
};

describe('RAG eval dataset', () => {
  it('requires expected sections and facts', () => {
    expect(ragEvalDatasetSchema.safeParse(dataset).success).toBe(true);
    expect(
      ragEvalDatasetSchema.safeParse({
        version: 1,
        questions: [{ id: 'x', question: 'q', expected: [], facts: [] }],
      }).success,
    ).toBe(false);
  });
});

describe('runRagEval', () => {
  it('reports rank, hits, and fact checks', async () => {
    const summary = await runRagEval({
      dataset,
      topK: 5,
      retrieve: async (question) =>
        question.startsWith('How much')
          ? [chunk('faq.md', 'Shipping'), chunk('shipping.md', 'Rates')]
          : [chunk('returns.md', 'Window')],
      answer: async (question) =>
        question.startsWith('How much') ? 'Standard is $5.95.' : 'Within 30 days.',
    });

    expect(summary.hitRate).toBe(1);
    expect(summary.factPassRate).toBe(1);
    expect(summary.allPassed).toBe(true);
    expect(summary.results[0]).toMatchObject({
      id: 'shipping',
      hit: true,
      rank: 2,
      factsPass: true,
    });
    expect(summary.results[1]).toMatchObject({ id: 'returns', rank: 1, factsPass: true });
  });

  it('gates a retrieval-only run on hits, not answers', async () => {
    const summary = await runRagEval({
      dataset,
      topK: 5,
      retrieve: async (question) =>
        question.startsWith('How much')
          ? [chunk('shipping.md', 'Rates')]
          : [chunk('returns.md', 'Window')],
    });

    expect(summary.hitRate).toBe(1);
    expect(summary.factPassRate).toBeNull();
    expect(summary.results.every((result) => !result.answered)).toBe(true);
    expect(summary.allPassed).toBe(true);
  });

  it('marks missing sections, missing facts, and retrieval errors', async () => {
    const summary = await runRagEval({
      dataset,
      topK: 1,
      retrieve: async (question) => {
        if (question.startsWith('How much')) return [chunk('faq.md', 'Shipping')];
        throw new Error('chroma down');
      },
      answer: async () => '30 days but no price',
    });

    expect(summary.hitRate).toBe(0);
    expect(summary.results[0]).toMatchObject({ hit: false, rank: null, factsPass: false });
    expect(summary.results[0]?.missingFacts).toEqual(['\\$5\\.95']);
    expect(summary.results[1]).toMatchObject({ error: 'chroma down' });
    expect(summary.allPassed).toBe(false);
  });

  it('matches facts across typographic hyphens and non-breaking spaces', async () => {
    const summary = await runRagEval({
      dataset: {
        ...dataset,
        questions: [
          {
            ...(dataset.questions[0] as (typeof dataset.questions)[number]),
            facts: ['12[\\s-]*month', '3\\s*[-–—]\\s*5\\s*business days'],
          },
        ],
      },
      topK: 5,
      retrieve: async () => [chunk('shipping.md', 'Rates')],
      answer: async () => 'A 12\u2011month warranty; shipping takes 3\u20135 business days.',
    });

    expect(normalizeForFacts('12\u2011month')).toBe('12-month');
    expect(summary.results[0]?.factsPass).toBe(true);
  });

  it('only answers from chunks inside maxDistance', async () => {
    const answered: RetrievedChunk[][] = [];
    const summary = await runRagEval({
      dataset,
      topK: 5,
      maxDistance: 0.2,
      retrieve: async () => [
        { ...chunk('shipping.md', 'Rates'), distance: 0.1 },
        { ...chunk('faq.md', 'Shipping'), distance: 0.9 },
      ],
      answer: async (_question, chunks) => {
        answered.push(chunks);
        return '$5.95';
      },
    });

    expect(answered[0]).toHaveLength(1);
    expect(summary.results[0]?.factsPass).toBe(true);
  });

  it('reports an empty grounded answer when nothing is within the distance', async () => {
    const summary = await runRagEval({
      dataset,
      topK: 5,
      maxDistance: 0.2,
      retrieve: async () => [{ ...chunk('shipping.md', 'Rates'), distance: 0.9 }],
      answer: async () => 'should not run',
    });
    expect(summary.results[0]).toMatchObject({ answered: true, answer: '', factsPass: false });
    expect(summary.factPassRate).toBe(0);
  });
});

describe('findExpectedRank', () => {
  it('matches on source and section together', () => {
    const question = dataset.questions[0] as (typeof dataset.questions)[number];
    expect(
      findExpectedRank([chunk('shipping.md', 'Other'), chunk('shipping.md', 'Rates')], question),
    ).toBe(2);
    expect(findExpectedRank([chunk('faq.md', 'Rates')], question)).toBeNull();
  });
});
