import { isSafeChatHref } from '@shopping-agent/shared';

export type ChatLinkSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; href: string; label: string };

/**
 * Linkifies only the safe store routes the server emits (PLAN §8.6): bare
 * `/products/:id`, `/orders/:id`, `/cart`, plus optional markdown links whose
 * href passes the shared allowlist. Everything else stays plain text.
 */
const LINK_PATTERN =
  /\[([^\]\n]{1,160})\]\(((?:[^()\s]|\([^()\s]*\))+)\)|(^|[\s(])(\/products\/[A-Za-z0-9_-]+(?![\w/-])|\/orders\/[A-Za-z0-9_-]+(?![\w/-])|\/cart(?![\w/-]))/g;

export function parseChatLinks(input: string): ChatLinkSegment[] {
  const segments: ChatLinkSegment[] = [];
  let cursor = 0;

  const pushText = (text: string): void => {
    if (text.length === 0) return;
    const last = segments.at(-1);
    if (last?.type === 'text') {
      last.text += text;
      return;
    }
    segments.push({ type: 'text', text });
  };

  LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = LINK_PATTERN.exec(input);
  while (match !== null) {
    const [full, markdownLabel, markdownHref, prefix, bareHref] = match;
    const start = match.index;
    pushText(input.slice(cursor, start));

    if (markdownHref !== undefined) {
      if (isSafeChatHref(markdownHref)) {
        segments.push({
          type: 'link',
          href: markdownHref,
          label: markdownLabel ?? markdownHref,
        });
      } else {
        pushText(markdownLabel ?? '');
      }
    } else if (bareHref !== undefined) {
      pushText(prefix ?? '');
      if (isSafeChatHref(bareHref)) {
        segments.push({ type: 'link', href: bareHref, label: bareHref });
      } else {
        pushText(bareHref);
      }
    }

    cursor = start + full.length;
    match = LINK_PATTERN.exec(input);
  }

  pushText(input.slice(cursor));
  return segments;
}
