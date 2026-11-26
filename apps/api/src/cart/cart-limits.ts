/**
 * Pure cart decision rules (PLAN §10.5 cart eval). `CartService` and the eval
 * runner call the same functions so the eval measures production behavior.
 */
import type { CartLimits } from '@shopping-agent/shared';

export type CartDecision =
  | { code: 'OK'; qty: number; message?: undefined }
  | { code: 'CART_LIMIT' | 'OUT_OF_STOCK'; message: string; qty?: undefined };

function stockMessage(name: string, stock: number): string {
  return `Only ${stock} of ${name} ${stock === 1 ? 'is' : 'are'} available.`;
}

export function checkAddLimits(input: {
  qty: number;
  lineCount: number;
  existingQty: number;
  stock: number;
  name: string;
  limits: CartLimits;
}): CartDecision {
  const { limits } = input;
  if (input.qty < 1 || input.qty > limits.maxQtyPerItem) {
    return {
      code: 'CART_LIMIT',
      message: `Quantity must be between 1 and ${limits.maxQtyPerItem}.`,
    };
  }
  const isNew = input.existingQty === 0;
  if (isNew && input.lineCount >= limits.maxLines) {
    return {
      code: 'CART_LIMIT',
      message: `Your cart already has the maximum of ${limits.maxLines} lines.`,
    };
  }
  const nextQty = isNew ? input.qty : Math.min(input.existingQty + input.qty, limits.maxQtyPerItem);
  if (input.stock < nextQty) {
    return { code: 'OUT_OF_STOCK', message: stockMessage(input.name, input.stock) };
  }
  return { code: 'OK', qty: nextQty };
}

export function checkUpdateLimits(input: {
  qty: number;
  stock: number;
  name: string;
  limits: CartLimits;
}): CartDecision {
  const { limits } = input;
  if (input.qty > limits.maxQtyPerItem) {
    return {
      code: 'CART_LIMIT',
      message: `Quantity must be between 0 and ${limits.maxQtyPerItem}.`,
    };
  }
  if (input.qty > 0 && input.stock < input.qty) {
    return { code: 'OUT_OF_STOCK', message: stockMessage(input.name, input.stock) };
  }
  return { code: 'OK', qty: input.qty };
}
