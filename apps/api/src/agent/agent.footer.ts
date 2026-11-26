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
  const lines = orders.map((order, index) => {
    const link = `/orders/${order.id}`;
    return `${index + 1}. ${label(order.orderNumber)} — ${label(order.status)} — ${formatUsd(
      order.totalCents,
    )} — ${isSafeChatHref(link) ? link : ''}`;
  });
  return `\n\nOrders:\n${lines.join('\n')}`;
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
