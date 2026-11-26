import type { Cart } from '@shopping-agent/shared';
import { AGENT_COPY } from './agent.policy';
import { resolveProductReference } from './agent.refs';
import type { LastCartSummary, ListedProduct } from './agent.types';

/**
 * Deterministic cart intent resolver (PLAN §8.5). It runs before any cart side
 * effect: the model may choose tool arguments, but code decides whether the
 * message is a real cart commit and which product/quantity it refers to.
 */
export type CartClarification = {
  needsClarification: true;
  question: string;
  reason: string;
};

export type CartIntent =
  | { action: 'view'; reason: string }
  | { action: 'add'; product: ListedProduct; qty: number; reason: string }
  | { action: 'update'; product: ListedProduct; qty: number; reason: string }
  | CartClarification;

const NON_COMMITTAL =
  /\b(?:maybe|perhaps|i'?m\s+thinking|thinking\s+about|i\s+might|might\s+want|just\s+looking|should\s+i|would\s+it\s+be|what\s+if)\b/i;

const VIEW = /\b(?:view|show|open|see|display|what(?:'s| is)\s+in)\b/i;
const ADD = /\b(?:add|adds|adding|put|puts|putting)\b/i;
const UPDATE =
  /\b(?:change|changes|changing|update|updates|updating|set|sets|setting|make|makes|making)\b/i;
const REMOVE =
  /\b(?:remove|removes|removing|delete|deletes|deleting)\b|\btak(?:e|es|ing)\b[^.!?]{0,30}\bout\b/i;
const CLEAR = /\b(?:clear|empty)\b/i;
const CART_WORD = /\b(?:cart|basket)\b/i;
const ORDER_WORD = /\b(?:order|buy|purchase|checkout|check\s+out|place\s+an?\s+order|get\s+me)\b/i;

const ORDINAL_PHRASE =
  /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:one|item|product|option|thing)\b/gi;
const ORDINAL_NUMBER_PHRASE = /\b\d+(?:st|nd|rd|th)\s+(?:one|item|product|option|thing)\b/gi;
const ORDINAL_NUMBER = /\b\d+(?:st|nd|rd|th)\b/gi;
const PRICE_PHRASE =
  /\$\s*\d+(?:\.\d{1,2})?|\b(?:under|below|less than|over|above|more than|up to|at least)\s+\$?\s*\d+(?:\.\d{1,2})?/gi;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

export function isNonCommittal(message: string): boolean {
  return NON_COMMITTAL.test(message);
}

/**
 * Quantity from the user's own message only. Ordinals ("second one") and
 * prices ("under $80") are stripped first so they cannot become a quantity.
 */
export function parseQuantity(message: string): number | null {
  const cleaned = message
    .replace(ORDINAL_NUMBER_PHRASE, ' ')
    .replace(ORDINAL_NUMBER, ' ')
    .replace(ORDINAL_PHRASE, ' ')
    .replace(PRICE_PHRASE, ' ');

  const patterns: RegExp[] = [
    /\b(?:qty|quantity)\s*[:=]?\s*(\d{1,2})\b/i,
    /\b(?:add|put)\s+(\d{1,2})\b/i,
    /\b(?:change|update|set|make)\b[^.!?]{0,25}?\b(?:to|at)\s+(\d{1,2})\b/i,
    /\bmake\s+(?:it\s+)?(\d{1,2})\b/i,
    /\b(\d{1,2})\s*(?:x|×)\b/i,
    /\bx\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s+(?:of|units?|items?|copies?|pairs?)\b/i,
    /\bto\s+(\d{1,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }

  const word = cleaned.match(/\b(one|two|three|four|five)\b/i);
  if (word?.[1]) return NUMBER_WORDS[word[1].toLowerCase()] ?? null;
  if (/\ba\s+couple\b/i.test(cleaned)) return 2;
  return null;
}

/** Cart lines as resolvable product references (positions follow cart order). */
export function cartToListedProducts(cart: Cart): ListedProduct[] {
  return cart.items.map((item, index) => ({
    id: item.productId,
    name: item.name,
    priceCents: item.unitPriceCents,
    ratingAvg: 0,
    ratingCount: 0,
    position: index + 1,
    sku: item.sku,
  }));
}

/** Bounded structured state written by cart tools (PLAN §8.2). */
export function summaryToListedProducts(summary: LastCartSummary): ListedProduct[] {
  if (!summary) return [];
  return summary.items.map((item, index) => ({
    id: item.productId,
    name: item.name,
    priceCents: item.unitPriceCents,
    ratingAvg: 0,
    ratingCount: 0,
    position: index + 1,
  }));
}

export function cartToSummary(cart: Cart): NonNullable<LastCartSummary> {
  return {
    items: cart.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      qty: item.qty,
      unitPriceCents: item.unitPriceCents,
    })),
    subtotalCents: cart.subtotalCents,
  };
}

export function parseCartIntent(
  message: string,
  listed: ListedProduct[],
  cartProducts: ListedProduct[] = [],
): CartIntent {
  const text = message.trim();
  if (text.length === 0) return clarify(AGENT_COPY.cartClarify, 'empty message');

  const hasCartWord = CART_WORD.test(text);
  const wantsView = VIEW.test(text) && hasCartWord;
  const wantsAdd = ADD.test(text) && hasCartWord;
  const wantsUpdate = UPDATE.test(text) && (hasCartWord || cartProducts.length > 0);
  const wantsRemove = REMOVE.test(text) && (hasCartWord || cartProducts.length > 0);

  if (!wantsView && !wantsAdd && !wantsUpdate && !wantsRemove) {
    if (CLEAR.test(text) && hasCartWord) {
      return clarify(AGENT_COPY.cartClearUnsupported, 'clear cart');
    }
    if (ORDER_WORD.test(text)) {
      return clarify(AGENT_COPY.orderClarify, 'order request');
    }
    if (hasCartWord) return { action: 'view', reason: 'cart mention' };
    return clarify(AGENT_COPY.cartClarify, 'no cart action');
  }

  if ((wantsAdd || wantsUpdate || wantsRemove) && isNonCommittal(text)) {
    return clarify(AGENT_COPY.cartNonCommittal, 'non-committal');
  }

  if (wantsAdd) {
    const reference = resolveProductReference(text, listed);
    if (reference === null) return clarify(AGENT_COPY.cartWhichProduct, 'no product reference');
    if ('ambiguous' in reference) return clarify(AGENT_COPY.cartAmbiguous, reference.reason);
    const qty = parseQuantity(text) ?? 1;
    const invalid = checkQty(qty, false);
    if (invalid) return invalid;
    return { action: 'add', product: reference.product, qty, reason: 'add to cart' };
  }

  if (wantsRemove) {
    const resolved = resolveUpdateProduct(text, listed, cartProducts);
    if ('needsClarification' in resolved) return resolved;
    return { action: 'update', product: resolved.product, qty: 0, reason: 'remove from cart' };
  }

  if (wantsUpdate) {
    const resolved = resolveUpdateProduct(text, listed, cartProducts);
    if ('needsClarification' in resolved) return resolved;
    const qty = parseQuantity(text);
    if (qty === null) return clarify(AGENT_COPY.cartQtyClarify, 'missing quantity');
    const invalid = checkQty(qty, true);
    if (invalid) return invalid;
    return { action: 'update', product: resolved.product, qty, reason: 'update cart quantity' };
  }

  return { action: 'view', reason: 'view cart' };
}

function resolveUpdateProduct(
  text: string,
  listed: ListedProduct[],
  cartProducts: ListedProduct[],
): { product: ListedProduct } | CartClarification {
  const fromCart = resolveProductReference(text, cartProducts);
  const fromListed = resolveProductReference(text, listed);

  if (fromCart && !('ambiguous' in fromCart) && fromListed && !('ambiguous' in fromListed)) {
    if (fromCart.product.id !== fromListed.product.id) {
      return clarify(AGENT_COPY.cartAmbiguous, 'cart and search lists disagree');
    }
    return { product: fromCart.product };
  }
  if (fromCart && !('ambiguous' in fromCart)) return { product: fromCart.product };
  if (fromListed && !('ambiguous' in fromListed)) return { product: fromListed.product };
  if (fromCart || fromListed) return clarify(AGENT_COPY.cartAmbiguous, 'ambiguous reference');
  return clarify(AGENT_COPY.cartWhichProduct, 'no product reference');
}

function checkQty(qty: number, allowZero: boolean): CartClarification | null {
  if (!Number.isInteger(qty) || qty < (allowZero ? 0 : 1) || qty > 5) {
    return clarify(AGENT_COPY.cartQtyLimit, 'quantity out of range');
  }
  return null;
}

function clarify(question: string, reason: string): CartClarification {
  return { needsClarification: true, question, reason };
}
