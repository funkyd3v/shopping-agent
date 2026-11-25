import type { Cart, CartLimits, CartWarning } from '@shopping-agent/shared';
import { formatUsd } from '../common/money';

/** Structural shape of a cart loaded with its items and products. */
export type CartRow = {
  id: string;
  items: Array<{
    productId: string;
    qty: number;
    priceAtAddCents: number;
    product: {
      name: string;
      sku: string;
      category: string;
      imageUrl: string | null;
      priceCents: number;
      stock: number;
    };
  }>;
};

/**
 * Pure cart projection (totals + warnings). Checkout always reprices from
 * `products`; this view only reports the current state (PLAN §9.1).
 */
export function buildCartView(cart: CartRow | null, limits: CartLimits): Cart {
  const warnings: CartWarning[] = [];

  const items = (cart?.items ?? []).map((item) => {
    const unitPriceCents = item.product.priceCents;
    const lineTotalCents = unitPriceCents * item.qty;
    const priceChanged = item.priceAtAddCents !== unitPriceCents;
    const outOfStock = item.product.stock <= 0;

    if (priceChanged) {
      warnings.push({
        code: 'PRICE_CHANGED',
        productId: item.productId,
        message: `The price of ${item.product.name} changed from ${formatUsd(item.priceAtAddCents)} to ${formatUsd(unitPriceCents)}.`,
      });
    }
    if (outOfStock) {
      warnings.push({
        code: 'OUT_OF_STOCK',
        productId: item.productId,
        message: `${item.product.name} is out of stock.`,
      });
    } else if (item.product.stock < item.qty) {
      warnings.push({
        code: 'OUT_OF_STOCK',
        productId: item.productId,
        message: `Only ${item.product.stock} of ${item.product.name} ${item.product.stock === 1 ? 'is' : 'are'} available.`,
      });
    }
    if (item.qty > limits.maxQtyPerItem) {
      warnings.push({
        code: 'QTY_LIMIT',
        productId: item.productId,
        message: `${item.product.name} is limited to ${limits.maxQtyPerItem} per order.`,
      });
    }

    return {
      productId: item.productId,
      name: item.product.name,
      sku: item.product.sku,
      category: item.product.category,
      imageUrl: item.product.imageUrl,
      qty: item.qty,
      unitPriceCents,
      priceAtAddCents: item.priceAtAddCents,
      lineTotalCents,
      stock: item.product.stock,
      priceChanged,
      outOfStock,
    };
  });

  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

  if (subtotalCents > limits.maxOrderCents) {
    warnings.push({
      code: 'CART_OVER_LIMIT',
      message: `Your subtotal of ${formatUsd(subtotalCents)} exceeds the ${formatUsd(limits.maxOrderCents)} per-order limit. Remove items before checkout.`,
    });
  }

  return {
    id: cart?.id ?? null,
    items,
    subtotalCents,
    itemCount,
    warnings,
    limits,
  };
}
