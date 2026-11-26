import { describe, expect, it } from 'vitest';
import {
  jailbreakDatasetSchema,
  piiDatasetSchema,
  runJailbreakEval,
  runPiiEval,
  summarize,
} from './guardrails.eval';

const jailbreakDataset = jailbreakDatasetSchema.parse({
  version: 1,
  attacks: Array.from({ length: 40 }, (_, index) => ({ id: `a${index}`, text: 'attack' })),
  benign: Array.from({ length: 40 }, (_, index) => ({
    id: `b${index}`,
    text: 'benign',
    core: index < 10,
  })),
});

const piiDataset = piiDatasetSchema.parse({
  version: 1,
  cases: [
    { id: 'p1', text: 'email me', kinds: ['email'], secrets: ['me'] },
    { id: 'p2', text: 'no pii', kinds: [], secrets: [] },
  ],
});

describe('runJailbreakEval', () => {
  it('reports block rate and false-positive rate and passes a good detector', () => {
    const result = runJailbreakEval(jailbreakDataset, ({ message }) => ({
      blocked: message === 'attack',
      score: message === 'attack' ? 1 : 0,
      reasons: [],
    }));
    expect(result.passed).toBe(true);
    expect(result.metrics.attackBlockRate).toBe(1);
    expect(result.metrics.falsePositiveRate).toBe(0);
  });

  it('fails when a core benign flow is false-blocked', () => {
    const result = runJailbreakEval(jailbreakDataset, () => ({
      blocked: true,
      score: 1,
      reasons: [],
    }));
    expect(result.passed).toBe(false);
    expect(result.metrics.coreFalseBlocks).toBe(10);
  });

  it('fails when attacks get through', () => {
    const result = runJailbreakEval(jailbreakDataset, () => ({
      blocked: false,
      score: 0,
      reasons: [],
    }));
    expect(result.metrics.attackBlockRate).toBe(0);
    expect(result.failures.filter((failure) => failure.startsWith('attack:'))).toHaveLength(40);
  });
});

describe('runPiiEval', () => {
  it('measures redaction and false positives', () => {
    const result = runPiiEval(piiDataset, (text) => ({
      text: text === 'email me' ? 'email [REDACTED_EMAIL]' : text,
      findings: text === 'email me' ? [{ kind: 'email', count: 1 }] : [],
    }));
    expect(result.passed).toBe(true);
    expect(result.metrics.redactionRate).toBe(1);
    expect(result.metrics.falsePositiveRate).toBe(0);
  });

  it('fails when a benign message is flagged', () => {
    const result = runPiiEval(piiDataset, () => ({
      text: 'redacted',
      findings: [{ kind: 'email', count: 1 }],
    }));
    expect(result.passed).toBe(false);
    expect(result.metrics.falsePositiveRate).toBe(1);
  });
});

describe('summarize', () => {
  it('aggregates category results', () => {
    expect(
      summarize([
        { category: 'a', cases: 1, passed: true, metrics: {}, failures: [] },
        { category: 'b', cases: 1, passed: false, metrics: {}, failures: ['x'] },
      ]),
    ).toEqual({ allPassed: false, passRate: 0.5 });
  });
});
