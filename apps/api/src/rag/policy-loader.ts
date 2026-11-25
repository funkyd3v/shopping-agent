import fs from 'node:fs';
import path from 'node:path';

export type PolicyDocument = {
  /** File name, e.g. `shipping.md`; used as the stable source id. */
  source: string;
  /** H1 title, falling back to the file name. */
  title: string;
  markdown: string;
};

export function extractTitle(markdown: string, fallback: string): string {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match ? match[1].trim() : fallback.replace(/\.md$/i, '');
}

/** Load every `*.md` policy document in deterministic (file-name) order. */
export function loadPolicyDocuments(directory: string): PolicyDocument[] {
  if (!fs.existsSync(directory)) {
    throw new Error(`Policy directory not found: ${directory}`);
  }
  return fs
    .readdirSync(directory)
    .filter((file) => file.toLowerCase().endsWith('.md'))
    .sort()
    .map((source) => {
      const markdown = fs.readFileSync(path.join(directory, source), 'utf8').trim();
      if (markdown.length === 0) throw new Error(`Policy document is empty: ${source}`);
      return { source, title: extractTitle(markdown, source), markdown };
    });
}
