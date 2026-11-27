import { formatUsd } from '../common/money';
import { getEnv } from '../config/env';

/**
 * Shared order policy (PLAN §9.5). Values come from `guardrails.policy.ts`
 * env overrides; the check order is deterministic: validate items → reprice →
 * total limit → qty limit → daily count → daily spend → stock → write.
 */
export type OrderLimits = {
  maxOrderCents: number;
  maxQtyPerItem: number;
  maxOrdersPerDay: number;
  maxSpendPerDayCents: number;
  cancelWindowMinutes: number;
};

export function orderLimits(): OrderLimits {
  const env = getEnv();
  return {
    maxOrderCents: env.MAX_ORDER_USD * 100,
    maxQtyPerItem: env.MAX_QTY_PER_ITEM,
    maxOrdersPerDay: env.MAX_AGENT_ORDERS_PER_DAY,
    maxSpendPerDayCents: env.MAX_AGENT_SPEND_PER_DAY_USD * 100,
    cancelWindowMinutes: env.CANCEL_WINDOW_MINUTES,
  };
}

/** A line after repricing from `products` (never from cart/model prices). */
export type PricedLine = {
  productId: string;
  name: string;
  sku: string;
  qty: number;
  unitPriceCents: number;
  stock: number;
};

export type OrderRefusalCode =
  | 'CART_EMPTY'
  | 'ORDER_LIMIT'
  | 'OUT_OF_STOCK'
  | 'NO_ADDRESS'
  | 'CANCEL_WINDOW_CLOSED'
  | 'DB_BUSY';

/** Structured refusal (PLAN §9.3): `code`, `limit`, `actual`, `allowed`. */
export type OrderRefusal = {
  code: OrderRefusalCode;
  message: string;
  limit?: number;
  actual?: number;
  allowed?: number;
  productId?: string;
};

/** Daily agent counters measured since UTC midnight (PLAN §9.5). */
export type DailyAgentUsage = { count: number; spendCents: number };

/**
 * Pure limit evaluation. Returns the first refusal in policy order, or `null`
 * when the order may be written. Money stays in integer cents.
 */
export function evaluateOrder(
  lines: PricedLine[],
  limits: OrderLimits,
  daily: DailyAgentUsage,
): OrderRefusal | null {
  if (lines.length === 0) {
    return { code: 'CART_EMPTY', message: 'Your cart is empty.' };
  }

  const totalCents = lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0);

  if (totalCents > limits.maxOrderCents) {
    return {
      code: 'ORDER_LIMIT',
      message: `That order totals ${formatUsd(totalCents)}, which is over the ${formatUsd(
        limits.maxOrderCents,
      )} per-order limit. Remove something and try again.`,
      limit: limits.maxOrderCents,
      actual: totalCents,
      allowed: limits.maxOrderCents,
    };
  }

  const overQty = lines.find((line) => line.qty > limits.maxQtyPerItem);
  if (overQty) {
    return {
      code: 'ORDER_LIMIT',
      message: `${overQty.name} is limited to ${limits.maxQtyPerItem} per order; you asked for ${overQty.qty}.`,
      limit: limits.maxQtyPerItem,
      actual: overQty.qty,
      allowed: limits.maxQtyPerItem,
      productId: overQty.productId,
    };
  }

  if (daily.count >= limits.maxOrdersPerDay) {
    return {
      code: 'ORDER_LIMIT',
      message: `You have reached the limit of ${limits.maxOrdersPerDay} assistant orders per day. Try again after midnight UTC.`,
      limit: limits.maxOrdersPerDay,
      actual: daily.count,
      allowed: limits.maxOrdersPerDay,
    };
  }

  const projectedSpendCents = daily.spendCents + totalCents;
  if (projectedSpendCents > limits.maxSpendPerDayCents) {
    return {
      code: 'ORDER_LIMIT',
      message: `Assistant orders total ${formatUsd(daily.spendCents)} today, so this ${formatUsd(
        totalCents,
      )} order would pass the ${formatUsd(limits.maxSpendPerDayCents)} daily spend limit.`,
      limit: limits.maxSpendPerDayCents,
      actual: projectedSpendCents,
      allowed: limits.maxSpendPerDayCents,
    };
  }

  const unavailable = lines.find((line) => line.stock < line.qty);
  if (unavailable) {
    return {
      code: 'OUT_OF_STOCK',
      message:
        unavailable.stock <= 0
          ? `${unavailable.name} is out of stock.`
          : `Only ${unavailable.stock} of ${unavailable.name} ${
              unavailable.stock === 1 ? 'is' : 'are'
            } available.`,
      limit: unavailable.qty,
      actual: unavailable.stock,
      allowed: unavailable.stock,
      productId: unavailable.productId,
    };
  }

  return null;
}

/** Start of the current UTC day (PLAN §9.5 daily caps). */
export function utcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Cancellation deadline for a newly placed order (PLAN §9.6, default 30 min). */
export function cancellableUntil(now: Date, limits: OrderLimits): Date {
  return new Date(now.getTime() + limits.cancelWindowMinutes * 60_000);
}
