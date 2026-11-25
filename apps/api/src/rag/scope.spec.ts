import { describe, expect, it } from 'vitest';
import { TurnAbortedError } from './retriever';
import {
  buildScopeClassifierMessages,
  classifyScopeHeuristic,
  parseScopeClassification,
  resolveScope,
} from './scope';

describe('scope heuristic', () => {
  it('keeps policy questions in scope even when they mention products', () => {
    for (const question of [
      'What is the return policy for a monitor?',
      'How much does standard shipping cost?',
      'Do you accept Visa and PayPal?',
      'How long do you keep chat transcripts?',
      'How much can I order at once?',
      'Can I cancel an order after it ships?',
    ]) {
      expect(classifyScopeHeuristic(question)).toBe('in');
    }
  });

  it('redirects cart, order, and product actions to the assistant', () => {
    for (const question of [
      'Add two of the cheapest monitors to my cart.',
      'Where is my order?',
      'Track my order please.',
      'Recommend a laptop under $1000.',
      'Is the HDP-100 in stock?',
      'Checkout now.',
    ]) {
      expect(classifyScopeHeuristic(question)).toBe('out');
    }
  });

  it('marks unrelated or vague questions ambiguous', () => {
    expect(classifyScopeHeuristic('What is the meaning of life?')).toBe('ambiguous');
    expect(classifyScopeHeuristic('   ')).toBe('ambiguous');
  });
});

describe('scope classifier parsing', () => {
  it('parses plain and fenced JSON', () => {
    expect(parseScopeClassification('{"inScope":true,"confidence":0.91}')).toEqual({
      inScope: true,
      confidence: 0.91,
    });
    expect(parseScopeClassification('```json\n{"inScope":false,"confidence":0.8}\n```')).toEqual({
      inScope: false,
      confidence: 0.8,
    });
    expect(parseScopeClassification('not json')).toBeNull();
  });

  it('builds a classifier prompt without hidden context', () => {
    const messages = buildScopeClassifierMessages('What is the meaning of life?');
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'What is the meaning of life?' });
  });

  it('includes recent conversation so follow-ups are interpreted in context', () => {
    const messages = buildScopeClassifierMessages('What about Canada?', [
      { role: 'user', content: 'How long does shipping take?' },
      { role: 'assistant', content: 'Standard shipping takes 3–5 business days.' },
    ]);
    const content = messages[1]?.content ?? '';
    expect(content).toContain('Customer: How long does shipping take?');
    expect(content).toContain('Latest question: What about Canada?');
  });
});

describe('resolveScope', () => {
  it('skips the classifier when the heuristic is decisive', async () => {
    let calls = 0;
    const result = await resolveScope('What is the shipping policy?', {
      classify: async () => {
        calls += 1;
        return '{"inScope":false,"confidence":0.99}';
      },
    });
    expect(result).toMatchObject({ scope: 'in', source: 'heuristic' });
    expect(calls).toBe(0);
  });

  it('uses a confident classifier rejection for ambiguous questions', async () => {
    const result = await resolveScope('What is the meaning of life?', {
      classify: async () => '{"inScope":false,"confidence":0.92}',
    });
    expect(result).toEqual({ scope: 'out', confidence: 0.92, source: 'classifier' });
  });

  it('allows low-confidence or malformed classifications instead of blocking', async () => {
    await expect(
      resolveScope('What is the meaning of life?', {
        classify: async () => '{"inScope":false,"confidence":0.2}',
      }),
    ).resolves.toMatchObject({ scope: 'in', source: 'classifier' });

    await expect(
      resolveScope('What is the meaning of life?', {
        classify: async () => 'garbage',
      }),
    ).resolves.toMatchObject({ scope: 'in', source: 'heuristic' });
  });

  it('fails open on classifier errors but propagates an abort', async () => {
    await expect(
      resolveScope('What is the meaning of life?', {
        classify: async () => {
          throw new Error('provider down');
        },
      }),
    ).resolves.toMatchObject({ scope: 'in' });

    await expect(
      resolveScope('What is the meaning of life?', {
        classify: async () => {
          throw new TurnAbortedError();
        },
      }),
    ).rejects.toBeInstanceOf(TurnAbortedError);
  });
});
