import { isSafeChatHref } from '@shopping-agent/shared';
import { formatUsd } from '../common/money';
import type { OrderFooterItem, ProductFooterItem } from './agent.types';

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

export function buildAgentFooter(products: ProductFooterItem[], orders: OrderFooterItem[]): string {
  return `${buildProductFooter(products)}${buildOrderFooter(orders)}`;
}

function label(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
