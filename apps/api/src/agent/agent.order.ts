import { isNonCommittal, parseQuantity } from './agent.cart';
import { AGENT_COPY } from './agent.policy';
import { resolveProductReference } from './agent.refs';
import type { LastOrder, ListedProduct } from './agent.types';

/**
 * Deterministic order intent resolver (PLAN §8.5, §9.4–§9.6). It runs before
 * any order side effect: the model may choose tool arguments, but code decides
 * whether the message is a real commit and which product/order it names.
 * Only structured state (`lastListedProducts`, `lastOrder`) can supply a
 * reference — review or description text never can.
 */
export type OrderLine = { productId: string; qty: number };

export type OrderClarification = {
  needsClarification: true;
  question: string;
  reason: string;
};

export type OrderIntent =
  | { action: 'quote'; fromCart: boolean; items: OrderLine[]; reason: string }
  | { action: 'place'; items: OrderLine[]; reason: string }
  | { action: 'checkout'; reason: string }
  | { action: 'cancel'; reference: string; reason: string }
  | OrderClarification;

const CANCEL = /\b(?:cancel|cancels|cancelling|canceling)\b/i;
const CHECKOUT = /\b(?:checkout|check\s+out)\b/i;
const ORDER_VERB =
  /\b(?:order|orders|ordered|ordering|buy|buys|buying|purchase|purchases|purchasing|place|places|placing|get\s+me)\b/i;
const CART_WORD = /\b(?:cart|basket)\b/i;
const QUOTE =
  /\b(?:how\s+much|what(?:'s|\s+is)\s+(?:the\s+)?(?:price|total|cost|damage)|what\s+would\s+(?:it|that|this)\s+cost|cost|price|quote|availability)\b/i;
const ORDER_NUMBER = /\bORD-[A-Z0-9]{4,}\b/i;
const ORDINAL_WORDS =
  /\b(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th|ninth|9th|tenth|10th)\b/gi;
const LAST_ORDER_REF =
  /\b(?:it|that|this|them|my\s+(?:last|latest|recent)\s+order|the\s+(?:last|latest)\s+order|last\s+one)\b/i;

/** Single resolvable product, or a clarification; never guesses between matches. */
function resolveOne(
  text: string,
  listed: ListedProduct[],
): { product: ListedProduct } | OrderClarification {
  const ordinals = [
    ...new Set((text.match(ORDINAL_WORDS) ?? []).map((value) => value.toLowerCase())),
  ];
  if (ordinals.length > 1) {
    return clarify(AGENT_COPY.orderAmbiguous, 'multiple ordinal references');
  }

  const reference = resolveProductReference(text, listed);
  if (reference === null) return clarify(AGENT_COPY.orderWhichProduct, 'no product reference');
  if ('ambiguous' in reference) return clarify(AGENT_COPY.orderAmbiguous, reference.reason);
  return { product: reference.product };
}

function quantityFor(text: string): { qty: number } | OrderClarification {
  const qty = parseQuantity(text) ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > 5) {
    return clarify(AGENT_COPY.orderQtyLimit, 'quantity out of range');
  }
  return { qty };
}

/**
 * Resolve an order/cancel/quote request from the customer's own message.
 * `lastOrder` supports "cancel it" after the assistant has raised an order.
 */
export function parseOrderIntent(
  message: string,
  listed: ListedProduct[],
  lastOrder: LastOrder = null,
): OrderIntent {
  const text = message.trim();
  if (text.length === 0) return clarify(AGENT_COPY.orderClarify, 'empty message');

  const hasAction =
    CANCEL.test(text) ||
    CHECKOUT.test(text) ||
    ORDER_VERB.test(text) ||
    QUOTE.test(text) ||
    resolveProductReference(text, listed) !== null;
  if (hasAction && isNonCommittal(text)) {
    return clarify(AGENT_COPY.orderNonCommittal, 'non-committal');
  }

  // Cancel wins over the generic "order" verb in "cancel order ORD-…".
  if (CANCEL.test(text)) {
    const explicit = text.match(ORDER_NUMBER)?.[0];
    if (explicit) {
      return {
        action: 'cancel',
        reference: explicit.toUpperCase(),
        reason: 'order number in message',
      };
    }
    if (lastOrder && LAST_ORDER_REF.test(text)) {
      return { action: 'cancel', reference: lastOrder.orderNumber, reason: 'last order' };
    }
    return clarify(AGENT_COPY.orderCancelWhich, 'no order reference');
  }

  if (CHECKOUT.test(text)) {
    const product = resolveProductReference(text, listed);
    if (product && !CART_WORD.test(text)) {
      return clarify(AGENT_COPY.orderCheckoutClarify, 'checkout with a product reference');
    }
    return { action: 'checkout', reason: 'checkout cart' };
  }

  if (QUOTE.test(text)) {
    if (CART_WORD.test(text) && !resolveProductReference(text, listed)) {
      return { action: 'quote', fromCart: true, items: [], reason: 'cart price question' };
    }
    const resolved = resolveOne(text, listed);
    if ('needsClarification' in resolved) return resolved;
    const quantity = quantityFor(text);
    if ('needsClarification' in quantity) return quantity;
    return {
      action: 'quote',
      fromCart: false,
      items: [{ productId: resolved.product.id, qty: quantity.qty }],
      reason: 'price question',
    };
  }

  if (ORDER_VERB.test(text)) {
    if (CART_WORD.test(text) && !resolveProductReference(text, listed)) {
      return { action: 'checkout', reason: 'order the cart' };
    }
    const resolved = resolveOne(text, listed);
    if ('needsClarification' in resolved) return resolved;
    const quantity = quantityFor(text);
    if ('needsClarification' in quantity) return quantity;
    return {
      action: 'place',
      items: [{ productId: resolved.product.id, qty: quantity.qty }],
      reason: 'direct order',
    };
  }

  return clarify(AGENT_COPY.orderClarify, 'no order action');
}

function clarify(question: string, reason: string): OrderClarification {
  return { needsClarification: true, question, reason };
}
