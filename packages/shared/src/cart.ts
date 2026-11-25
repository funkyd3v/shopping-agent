import { z } from 'zod';

/**
 * Cart contracts shared by REST, the web app, and (later) agent tools.
 * Money is integer cents; qty limits mirror PLAN §9.2.
 */

export const CART_WARNING_CODES = [
  'PRICE_CHANGED',
  'OUT_OF_STOCK',
  'CART_OVER_LIMIT',
  'QTY_LIMIT',
] as const;

export const cartWarningSchema = z.object({
  code: z.enum(CART_WARNING_CODES),
  message: z.string(),
  productId: z.string().optional(),
});

export type CartWarning = z.infer<typeof cartWarningSchema>;

export const cartLimitsSchema = z.object({
  maxLines: z.number().int().positive(),
  maxQtyPerItem: z.number().int().positive(),
  maxOrderCents: z.number().int().nonnegative(),
});

export type CartLimits = z.infer<typeof cartLimitsSchema>;

export const cartLineSchema = z.object({
  productId: z.string(),
  name: z.string(),
  sku: z.string(),
  category: z.string(),
  imageUrl: z.string().nullable(),
  qty: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  priceAtAddCents: z.number().int().nonnegative(),
  lineTotalCents: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  priceChanged: z.boolean(),
  outOfStock: z.boolean(),
});

export type CartLine = z.infer<typeof cartLineSchema>;

export const cartSchema = z.object({
  /** Null until the first add creates the cart lazily (PLAN §9.1). */
  id: z.string().nullable(),
  items: z.array(cartLineSchema),
  subtotalCents: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  warnings: z.array(cartWarningSchema),
  limits: cartLimitsSchema,
});

export type Cart = z.infer<typeof cartSchema>;

export const cartResponseSchema = z.object({ cart: cartSchema });

export const addCartItemSchema = z.object({
  productId: z.string().trim().min(1).max(64),
  qty: z.coerce.number().int().min(1).max(5).default(1),
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemSchema = z.object({
  /** 0 removes the line. */
  qty: z.coerce.number().int().min(0).max(5),
});

export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
