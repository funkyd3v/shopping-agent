import { describe, expect, it } from 'vitest';
import { chunkPolicy, embeddingText } from './chunker';
import type { PolicyDocument } from './policy-loader';

const document: PolicyDocument = {
  source: 'shipping.md',
  title: 'Shipping Policy',
  markdown: `# Shipping Policy

Intro paragraph with the **2:00 PM** cutoff.

## Rates

| Method | Cost |
|---|---|
| Standard | $5.95 |
| Expedited | $14.95 |

## Returns

Return within 30 days.`,
};

describe('policy chunker', () => {
  it('splits on H2 headings and keeps the document title out of chunk bodies', () => {
    const chunks = chunkPolicy(document);
    expect(chunks.map((chunk) => chunk.section)).toEqual(['Overview', 'Rates', 'Returns']);
    expect(chunks.every((chunk) => chunk.title === 'Shipping Policy')).toBe(true);
    expect(chunks[0].content).toContain('2:00 PM');
    expect(chunks[0].content).not.toContain('# Shipping Policy');
  });

  it('keeps a markdown table intact inside one chunk', () => {
    const chunks = chunkPolicy(document);
    const rates = chunks.find((chunk) => chunk.section === 'Rates');
    expect(rates?.content).toContain('| Method | Cost |');
    expect(rates?.content).toContain('| Expedited | $14.95 |');
  });

  it('does not split a table even when it exceeds maxChars', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `| Item ${i} | $${i}.00 |`);
    const longTable = `| Item | Price |\n|---|---|\n${rows.join('\n')}`;
    const chunks = chunkPolicy(
      {
        source: 'long.md',
        title: 'Long',
        markdown: `# Long\n\n## Table\n\n${longTable}`,
      },
      { maxChars: 300, overlapChars: 40 },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('| Item 39 | $39.00 |');
  });

  it('produces stable ids and hashes across runs', () => {
    const first = chunkPolicy(document);
    const second = chunkPolicy(document);
    expect(second).toEqual(first);
    expect(new Set(first.map((chunk) => chunk.id)).size).toBe(first.length);
    expect(first[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('splits oversized prose with overlap and respects maxChars', () => {
    const paragraph = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkPolicy(
      {
        source: 'long.md',
        title: 'Long',
        markdown: `# Long\n\n## Prose\n\n${paragraph}`,
      },
      { maxChars: 500, overlapChars: 80 },
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 500)).toBe(true);
    // Overlap means words from the end of one chunk reappear at the head of the next.
    const nextWords = new Set(chunks[1].content.split(/\s+/));
    const tailWords = chunks[0].content.split(/\s+/).slice(-10);
    expect(tailWords.some((word) => nextWords.has(word))).toBe(true);
  });

  it('builds embedding text with title and section context', () => {
    const [chunk] = chunkPolicy(document);
    expect(embeddingText(chunk)).toBe(`# Shipping Policy\n## Overview\n\n${chunk.content}`);
  });
});
