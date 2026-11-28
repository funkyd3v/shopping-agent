import { isSafeChatHref } from '@shopping-agent/shared';
import { markdownLabel } from './agent.footer';

export type ProductLinkRef = { id: string; name: string };

/**
 * Markdown link for a product, or null when the id cannot form a safe store
 * route. Used in tool envelopes so a model that copies a link copies readable
 * text instead of a bare `/products/:id` path.
 */
export function productChatLink(id: string, name: string): string | null {
  const href = `/products/${id}`;
  return isSafeChatHref(href) ? `[${markdownLabel(name)}](${href})` : null;
}

/**
 * Deterministic safety net for model output (PLAN §8.6): replace any bare
 * `/products/:id` with a markdown link whose text is the product name. The
 * server appends the authoritative product list, but models occasionally echo
 * a raw path from a tool result anyway. Unknown ids keep a generic label so a
 * raw path is never shown in the transcript.
 */
export function linkifyProductPaths(text: string, products: ProductLinkRef[]): string {
  if (!text.includes('/products/')) return text;
  const names = new Map(products.map(({ id, name }) => [id, markdownLabel(name)]));
  return text.replace(
    // Not preceded by a URL/markdown-link char, and not already a `](href)`.
    /(?<![\w:/.-])(?<!\]\()\/products\/([A-Za-z0-9_-]+)(?![\w/-])/g,
    (path, id: string) =>
      isSafeChatHref(path) ? `[${names.get(id) ?? 'this product'}](${path})` : path,
  );
}
