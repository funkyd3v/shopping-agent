import { createHash } from 'node:crypto';
import type { PolicyDocument } from './policy-loader';

/**
 * Markdown-aware policy chunker (PLAN §7): split on H2 headings first, keep
 * tables intact, then pack paragraphs into ~500–800 token chunks with ~80
 * tokens of overlap. Token counts are approximated at 4 chars/token.
 */
export const CHUNKER_VERSION = 'policy-markdown-v1';
export const DEFAULT_MAX_CHARS = 2_800; // ~700 tokens
export const DEFAULT_OVERLAP_CHARS = 320; // ~80 tokens

export type PolicyChunk = {
  id: string;
  source: string;
  title: string;
  section: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
};

export type ChunkOptions = {
  maxChars?: number;
  overlapChars?: number;
};

type Block = { text: string; kind: 'table' | 'text' };

type Section = { title: string; body: string };

export function chunkPolicy(document: PolicyDocument, options: ChunkOptions = {}): PolicyChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  if (maxChars < 200) throw new Error('maxChars must be at least 200');
  if (overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error('overlapChars must be >= 0 and smaller than maxChars');
  }

  const sourceSlug = document.source.replace(/\.md$/i, '').toLowerCase();
  const chunks: PolicyChunk[] = [];
  let chunkIndex = 0;
  const usedSectionIds = new Map<string, number>();

  for (const section of splitSections(document.markdown, document.title)) {
    const baseSectionId = slugify(section.title) || 'overview';
    const seen = usedSectionIds.get(baseSectionId) ?? 0;
    usedSectionIds.set(baseSectionId, seen + 1);
    const sectionId = seen === 0 ? baseSectionId : `${baseSectionId}-${seen + 1}`;

    const blocks = toBlocks(section.body);
    const packed = packBlocks(blocks, maxChars, overlapChars);
    for (const [sectionChunkIndex, content] of packed.entries()) {
      const trimmed = content.trim();
      if (trimmed.length === 0) continue;
      chunks.push({
        id: `${sourceSlug}:${sectionId}:${sectionChunkIndex}`,
        source: document.source,
        title: document.title,
        section: section.title,
        chunkIndex,
        content: trimmed,
        contentHash: sha256(trimmed),
      });
      chunkIndex += 1;
    }
  }

  return chunks;
}

/** Text sent to the embedding model; keeps heading context in the vector. */
export function embeddingText(chunk: PolicyChunk): string {
  return `# ${chunk.title}\n## ${chunk.section}\n\n${chunk.content}`;
}

function splitSections(markdown: string, fallbackTitle: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  let currentTitle = 'Overview';
  let currentLines: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const body = currentLines.join('\n').trim();
    if (body.length > 0) sections.push({ title: currentTitle, body });
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h2 = !inFence ? /^##\s+(.+?)\s*#*\s*$/.exec(line) : null;
    const h1 = !inFence ? /^#\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h2) {
      flush();
      currentTitle = h2[1].trim();
      currentLines = [];
      continue;
    }
    if (h1) {
      // The H1 is the document title; keep it out of chunk bodies.
      if (sections.length === 0 && currentLines.every((value) => value.trim() === '')) {
        currentLines = [];
      }
      continue;
    }
    currentLines.push(line);
  }
  flush();

  if (sections.length === 0) {
    return [{ title: fallbackTitle, body: markdown }];
  }
  return sections;
}

/** Keep markdown tables as atomic blocks; paragraphs/lists stay together. */
function toBlocks(body: string): Block[] {
  const lines = body.split(/\r?\n/);
  const blocks: Block[] = [];
  let textLines: string[] = [];
  let tableLines: string[] = [];
  let inFence = false;

  const flushText = (): void => {
    const text = textLines.join('\n').trim();
    if (text.length > 0) blocks.push({ text, kind: 'text' });
    textLines = [];
  };
  const flushTable = (): void => {
    const text = tableLines.join('\n').trim();
    if (text.length > 0) blocks.push({ text, kind: 'table' });
    tableLines = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      flushTable();
      textLines.push(line);
      continue;
    }
    const isTableLine = !inFence && /^\s*\|/.test(line);
    if (isTableLine) {
      flushText();
      tableLines.push(line);
      continue;
    }
    if (tableLines.length > 0) flushTable();
    if (line.trim() === '') {
      flushText();
      continue;
    }
    textLines.push(line);
  }
  flushText();
  flushTable();
  return blocks;
}

function packBlocks(blocks: Block[], maxChars: number, overlapChars: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let lastKind: Block['kind'] = 'text';

  const pushCurrent = (): void => {
    if (current.trim().length > 0) chunks.push(current);
  };

  // Leave room for the overlap so a full prose piece plus its overlap still
  // fits within maxChars.
  const pieceLimit = overlapChars > 0 ? Math.max(200, maxChars - overlapChars) : maxChars;

  for (const block of blocks) {
    const pieces = block.kind === 'table' ? [block.text] : splitOversized(block.text, pieceLimit);
    for (const piece of pieces) {
      if (current.length === 0) {
        current = piece;
        lastKind = block.kind;
        continue;
      }
      if (current.length + 2 + piece.length <= maxChars) {
        current = `${current}\n\n${piece}`;
        lastKind = block.kind;
        continue;
      }
      pushCurrent();
      // Never cut a table in half to create overlap; overlap only prose, and
      // keep the overlap inside maxChars so every prose chunk respects the cap.
      const overlap = lastKind === 'table' ? '' : overlapTail(current, overlapChars);
      const room = maxChars - piece.length - 2;
      const fitted = room > 0 ? overlapTail(overlap, room) : '';
      current = fitted.length > 0 ? `${fitted}\n\n${piece}` : piece;
      lastKind = block.kind;
    }
  }
  pushCurrent();
  return chunks;
}

function splitOversized(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      pieces.push(current);
      current = word;
    }
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
}

function overlapTail(text: string, overlapChars: number): string {
  if (overlapChars === 0 || text.length === 0) return '';
  const tail = text.slice(Math.max(0, text.length - overlapChars));
  const firstSpace = tail.search(/\s/);
  return (firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail).trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
