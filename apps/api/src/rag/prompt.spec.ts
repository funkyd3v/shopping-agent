import { describe, expect, it } from 'vitest';
import {
  ANSWER_SYSTEM_PROMPT,
  buildAnswerMessages,
  sanitizeAnswer,
  sourcesFromChunks,
} from './prompt';
import type { RetrievedChunk } from './retriever';

const chunk = (overrides: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  id: 'chunk_1',
  source: 'shipping.md',
  title: 'Shipping Policy',
  section: 'Shipping methods and rates',
  content: 'Standard shipping is $5.95 and free over $50.00.',
  distance: 0.1,
  ...overrides,
});

describe('grounded prompt', () => {
  it('puts retrieved context in a delimited untrusted block', () => {
    const messages = buildAnswerMessages('How much is shipping?', [chunk()]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe(ANSWER_SYSTEM_PROMPT);
    expect(messages[1]?.content).toContain('<policy_context>');
    expect(messages[1]?.content).toContain('[1] Shipping Policy — Shipping methods and rates');
    expect(messages[1]?.content).toContain('Question: How much is shipping?');
  });

  it('bounds the context and never exceeds the character budget', () => {
    const chunks = [
      chunk({ id: '1', content: 'A'.repeat(500) }),
      chunk({ id: '2', section: 'Second', content: 'B'.repeat(500) }),
      chunk({ id: '3', section: 'Third', content: 'C'.repeat(500) }),
    ];
    const messages = buildAnswerMessages('Question', chunks, 900);
    const content = messages[1]?.content ?? '';
    const start = content.indexOf('<policy_context>') + '<policy_context>'.length;
    const end = content.indexOf('</policy_context>');
    const context = content.slice(start, end);
    expect(context.length).toBeLessThanOrEqual(900);
    expect(context).not.toContain('Third');
  });

  it('strips markup from source labels', () => {
    const messages = buildAnswerMessages('Question', [
      chunk({ title: '<b>Shipping</b>\nPolicy', section: 'Rates <script>' }),
    ]);
    const content = messages[1]?.content ?? '';
    expect(content).toContain('[1] Shipping Policy — Rates');
    expect(content).not.toContain('<b>');
    expect(content).not.toContain('<script>');
  });
});

describe('sources', () => {
  it('deduplicates and caps sources while preserving retrieval order', () => {
    const chunks = [
      chunk(),
      chunk({ section: 'Processing time' }),
      chunk(),
      chunk({ source: 'faq.md', title: 'FAQ', section: 'Shipping' }),
    ];
    expect(sourcesFromChunks(chunks, 2)).toEqual([
      { source: 'shipping.md', title: 'Shipping Policy', section: 'Shipping methods and rates' },
      { source: 'shipping.md', title: 'Shipping Policy', section: 'Processing time' },
    ]);
  });
});

describe('answer sanitation', () => {
  it('removes HTML, scripts, and active link schemes', () => {
    const sanitized = sanitizeAnswer(
      '<script>alert(1)</script>Pay <b>now</b> <a href="javascript:alert(1)">here</a>.',
    );
    expect(sanitized).not.toContain('<');
    expect(sanitized).not.toContain('javascript:');
    expect(sanitized).toContain('Pay');
    expect(sanitized).toContain('now');
  });

  it('keeps only validated store links and https links', () => {
    const sanitized = sanitizeAnswer(
      'See [cart](/cart), [product](/products/hdp-100), [bad](/admin), [ext](https://example.com).',
    );
    expect(sanitized).toContain('[cart](/cart)');
    expect(sanitized).toContain('[product](/products/hdp-100)');
    expect(sanitized).toContain('[ext](https://example.com)');
    expect(sanitized).toContain('bad');
    expect(sanitized).not.toContain('/admin');
  });

  it('caps length and collapses excessive blank lines', () => {
    expect(sanitizeAnswer('a'.repeat(50), 10)).toBe('aaaaaaaaa…');
    expect(sanitizeAnswer('one\n\n\n\ntwo')).toBe('one\n\ntwo');
  });

  it('converts markdown emphasis, headings, code, and bullets to plain text', () => {
    expect(
      sanitizeAnswer('## Cancellation\n**30 minutes** and __five__ `days`\n* first\n+ second'),
    ).toBe('Cancellation\n30 minutes and five days\n- first\n- second');
  });
});
