import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTitle, loadPolicyDocuments } from './policy-loader';

const policiesDir = path.resolve(process.cwd(), '../../content/policies');

describe('policy loader', () => {
  it('extracts the H1 title and falls back to the file name', () => {
    expect(extractTitle('# Shipping Policy\n\nBody', 'shipping.md')).toBe('Shipping Policy');
    expect(extractTitle('No heading here', 'returns.md')).toBe('returns');
  });

  it('loads every policy document with a title, table, and numeric fact', () => {
    const documents = loadPolicyDocuments(policiesDir);
    expect(documents.map((document) => document.source)).toEqual([
      'cancellation.md',
      'faq.md',
      'payment-methods.md',
      'privacy.md',
      'returns.md',
      'shipping.md',
      'warranty.md',
    ]);
    for (const document of documents) {
      expect(document.title.length).toBeGreaterThan(0);
      expect(document.markdown).toContain('|');
      expect(document.markdown).toMatch(/\d/);
    }
  });

  it('fails clearly when the directory is missing', () => {
    expect(() => loadPolicyDocuments(path.join(policiesDir, 'missing'))).toThrow(
      /Policy directory not found/,
    );
  });
});
