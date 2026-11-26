import { PRODUCT_CATEGORIES } from '@shopping-agent/shared';
import type { ListedProduct } from './agent.types';

/**
 * Deterministic product reference resolution for read-only agents (PLAN §8.5
 * rule 3). Only IDs from `lastListedProducts` can match; review/description text
 * is never a source of product references.
 */
export type ProductReference =
  | { product: ListedProduct; index: number; reason: string }
  | { ambiguous: true; reason: string }
  | null;

const ORDINALS: Array<{ words: RegExp; index: number }> = [
  { words: /\b(?:first|1st)\b/i, index: 0 },
  { words: /\b(?:second|2nd)\b/i, index: 1 },
  { words: /\b(?:third|3rd)\b/i, index: 2 },
  { words: /\b(?:fourth|4th)\b/i, index: 3 },
  { words: /\b(?:fifth|5th)\b/i, index: 4 },
  { words: /\b(?:sixth|6th)\b/i, index: 5 },
  { words: /\b(?:seventh|7th)\b/i, index: 6 },
  { words: /\b(?:eighth|8th)\b/i, index: 7 },
  { words: /\b(?:ninth|9th)\b/i, index: 8 },
  { words: /\b(?:tenth|10th)\b/i, index: 9 },
];

export function resolveProductReference(
  message: string,
  products: ListedProduct[],
): ProductReference {
  const text = message.trim();
  if (text.length === 0 || products.length === 0) return null;

  // Explicit product id or SKU always wins.
  const lower = text.toLowerCase();
  const explicit = products.find((product) => lower.includes(product.id.toLowerCase()));
  if (explicit) {
    return {
      product: explicit,
      index: explicit.position - 1,
      reason: 'explicit product id',
    };
  }
  const bySku = products.find(
    (product) => product.sku !== undefined && lower.includes(product.sku.toLowerCase()),
  );
  if (bySku) {
    return { product: bySku, index: bySku.position - 1, reason: 'explicit sku' };
  }

  for (const ordinal of ORDINALS) {
    if (!ordinal.words.test(text)) continue;
    const product = products[ordinal.index];
    if (!product) return { ambiguous: true, reason: 'ordinal out of range' };
    return { product, index: ordinal.index, reason: 'ordinal' };
  }

  if (/\b(?:cheapest|least expensive|lowest price)\b/i.test(text)) {
    return byPrice(products, 'min', 'cheapest');
  }
  if (/\b(?:most expensive|priciest|highest price)\b/i.test(text)) {
    return byPrice(products, 'max', 'most expensive');
  }
  if (/\b(?:highest rated|best rated|top rated)\b/i.test(text)) {
    return byRating(products, 'max');
  }
  if (/\b(?:lowest rated|worst rated)\b/i.test(text)) {
    return byRating(products, 'min');
  }
  if (/\b(?:last one|the last)\b/i.test(text)) {
    const product = products.at(-1);
    if (!product) return null;
    return { product, index: products.length - 1, reason: 'last' };
  }

  // Full name or a unique distinctive name token.
  const byName = products.filter((product) => lower.includes(product.name.toLowerCase()));
  if (byName.length === 1) {
    const product = byName[0] as ListedProduct;
    return { product, index: product.position - 1, reason: 'product name' };
  }
  if (byName.length > 1) return { ambiguous: true, reason: 'multiple product names' };

  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
  const tokenMatches = products.filter((product) => {
    const name = product.name.toLowerCase();
    return tokens.some((token) => name.includes(token));
  });
  if (tokenMatches.length === 1) {
    const product = tokenMatches[0] as ListedProduct;
    return { product, index: product.position - 1, reason: 'unique name token' };
  }
  if (tokenMatches.length > 1) return { ambiguous: true, reason: 'multiple product matches' };

  // A single listed product is a safe implicit reference for "it"/"that".
  if (products.length === 1 && /\b(?:it|that|this|them|they)\b/i.test(text)) {
    const product = products[0] as ListedProduct;
    return { product, index: 0, reason: 'single listed product' };
  }

  return null;
}

function byPrice(
  products: ListedProduct[],
  direction: 'min' | 'max',
  reason: string,
): ProductReference {
  const sorted = [...products].sort((a, b) =>
    direction === 'min' ? a.priceCents - b.priceCents : b.priceCents - a.priceCents,
  );
  const best = sorted[0] as ListedProduct;
  const ties = products.filter((product) => product.priceCents === best.priceCents);
  if (ties.length > 1) return { ambiguous: true, reason: `multiple ${reason} products` };
  return { product: best, index: best.position - 1, reason };
}

function byRating(products: ListedProduct[], direction: 'min' | 'max'): ProductReference {
  const sorted = [...products].sort((a, b) =>
    direction === 'min' ? a.ratingAvg - b.ratingAvg : b.ratingAvg - a.ratingAvg,
  );
  const best = sorted[0] as ListedProduct;
  const ties = products.filter((product) => product.ratingAvg === best.ratingAvg);
  if (ties.length > 1) return { ambiguous: true, reason: 'multiple equally rated products' };
  return { product: best, index: best.position - 1, reason: 'rating' };
}

const PRICE_PHRASE =
  /\b(?:under|below|less than|up to|max(?:imum)?(?: of)?|over|above|more than|at least|min(?:imum)?(?: of)?)\s*\$?\s*\d+(?:\.\d{1,2})?\b/gi;

/**
 * Grounded fallback when the search model answers without calling a tool.
 * Extracts a dollar range and a compact query from the user's own message.
 */
export function parseSearchFallback(message: string): {
  query?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
} {
  const maxMatch = message.match(
    /\b(?:under|below|less than|up to|max(?:imum)?(?: of)?)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i,
  );
  const minMatch = message.match(
    /\b(?:over|above|more than|at least|min(?:imum)?(?: of)?)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i,
  );
  const category = PRODUCT_CATEGORIES.find((value) =>
    new RegExp(`\\b${value.toLowerCase()}\\b`, 'i').test(message),
  );

  const query = message
    .replace(PRICE_PHRASE, ' ')
    .replace(
      /\b(?:find|show|search|look(?:ing)? for|recommend|suggest|me|please|some|a|an|the|products?|items?|options?|that|which|are|is|with)\b/gi,
      ' ',
    )
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  return {
    ...(query.length > 0 ? { query } : {}),
    ...(category ? { category } : {}),
    ...(maxMatch?.[1] ? { maxPrice: Number(maxMatch[1]) } : {}),
    ...(minMatch?.[1] ? { minPrice: Number(minMatch[1]) } : {}),
  };
}
