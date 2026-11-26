import { isSafeChatHref } from '@shopping-agent/shared';
import { formatUsd } from '../common/money';
import type { LastCartSummary, OrderFooterItem, ProductFooterItem } from './agent.types';

/**
 * Server-generated facts footers (PLAN §8.6). Built from DB data after output
 * guardrails so the model cannot alter IDs, links, prices, or totals.
 */
export function buildProductFooter(products: ProductFooterItem[]): string {
  if (products.length === 0) return '';
  const lines = products.map((product, index) => {
    const rating = product.ratingCount > 0 ? `${product.ratingAvg.toFixed(1)}/5` : 'no ratings yet';
    const link = `/products/${product.id}`;
    return `${index + 1}. ${label(product.name)} — ${formatUsd(product.priceCents)} — ${rating} — ${
      isSafeChatHref(link) ? link : ''
    }`;
  });
  return `\n\nProducts:\n${lines.join('\n')}`;
}

export function buildOrderFooter(orders: OrderFooterItem[]): string {
  if (orders.length === 0) return '';
  const receipts = orders.filter((order) => order.receipt);
  const summaries = orders.filter((order) => !order.receipt);

  const receiptText = receipts
    .map((order) => {
      const link = `/orders/${order.id}`;
      const actor =
        order.placedBy === 'agent'
          ? 'placed by the assistant'
          : order.placedBy === 'user'
            ? 'placed by you'
            : null;
      const origin = order.source === 'cart' ? 'from your cart' : null;
      const heading = [label(order.orderNumber), actor, origin].filter(Boolean).join(' — ');
      const items = (order.items ?? [])
        .map(
          (item, index) =>
            `${index + 1}. ${label(item.name)} — ${item.qty} × ${formatUsd(
              item.unitPriceCents,
            )} = ${formatUsd(item.qty * item.unitPriceCents)}`,
        )
        .join('\n');
      const status =
        order.status === 'cancelled' && order.cancelledAt
          ? `cancelled${order.cancelledBy ? ` by ${order.cancelledBy === 'agent' ? 'the assistant' : 'you'}` : ''}`
          : label(order.status);
      const deadline = order.status === 'placed' ? localTimestamp(order.cancellableUntil) : null;
      return [
        `Order ${heading}`,
        ...(items.length > 0 ? [items] : []),
        `Total: ${formatUsd(order.totalCents)}`,
        `Status: ${status}${deadline ? ` — cancellable until ${deadline}` : ''}`,
        isSafeChatHref(link) ? link : '',
      ]
        .filter((line) => line.length > 0)
        .join('\n');
    })
    .join('\n\n');

  const summaryText =
    summaries.length === 0
      ? ''
      : `\n\nOrders:\n${summaries
          .map((order, index) => {
            const link = `/orders/${order.id}`;
            return `${index + 1}. ${label(order.orderNumber)} — ${label(order.status)} — ${formatUsd(
              order.totalCents,
            )} — ${isSafeChatHref(link) ? link : ''}`;
          })
          .join('\n')}`;

  return `${receiptText.length > 0 ? `\n\nReceipt:\n${receiptText}` : ''}${summaryText}`;
}

/** Cancel deadlines are shown in the server's local time (PLAN §9.8). */
function localTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return date.toISOString();
  }
}

export function buildCartFooter(cart: LastCartSummary): string {
  if (!cart) return '';
  const link = '/cart';
  if (cart.items.length === 0) {
    return `\n\nCart: empty${isSafeChatHref(link) ? ` — ${link}` : ''}`;
  }
  const lines = cart.items.map((item, index) => {
    const lineTotalCents = item.unitPriceCents * item.qty;
    return `${index + 1}. ${label(item.name)} — ${item.qty} × ${formatUsd(
      item.unitPriceCents,
    )} = ${formatUsd(lineTotalCents)}`;
  });
  return `\n\nCart:\n${lines.join('\n')}\nSubtotal: ${formatUsd(cart.subtotalCents)}${
    isSafeChatHref(link) ? `\n${link}` : ''
  }`;
}

export function buildAgentFooter(
  products: ProductFooterItem[],
  orders: OrderFooterItem[],
  cart: LastCartSummary = null,
): string {
  return `${buildProductFooter(products)}${buildOrderFooter(orders)}${buildCartFooter(cart)}`;
}

function label(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
