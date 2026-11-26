import { z } from 'zod';
import { addressSchema, clientRequestIdSchema } from './dto.js';

/** Enum-like order values (SQLite has no native enums; PLAN §5). */
export const ORDER_STATUSES = ['placed', 'cancelled', 'shipped', 'delivered'] as const;
export const ORDER_SOURCES = ['direct', 'cart'] as const;
export const ORDER_PLACED_BY = ['user', 'agent'] as const;

export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const orderSourceSchema = z.enum(ORDER_SOURCES);
export const orderPlacedBySchema = z.enum(ORDER_PLACED_BY);

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OrderSource = z.infer<typeof orderSourceSchema>;
export type OrderPlacedBy = z.infer<typeof orderPlacedBySchema>;

const optionalQueryText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional(),
  );

export const orderListQuerySchema = z.object({
  status: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    orderStatusSchema.optional(),
  ),
  limit: z.preprocess(
    (v) => (v === undefined || v === '' ? 20 : v),
    z.coerce.number().int().min(1).max(100),
  ),
  cursor: optionalQueryText(500),
});

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

/** `POST /cart/checkout` body (PLAN §13). Idempotent per (user, key). */
export const checkoutRequestSchema = z.object({
  clientRequestId: clientRequestIdSchema,
});

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const orderItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  productName: z.string(),
  sku: z.string(),
  qty: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
});

export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSummarySchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  status: orderStatusSchema,
  source: orderSourceSchema,
  placedBy: orderPlacedBySchema,
  totalCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  cancellableUntil: z.string().nullable(),
  cancellable: z.boolean(),
  cancelledAt: z.string().nullable(),
});

export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const orderDetailSchema = orderSummarySchema.extend({
  items: z.array(orderItemSchema),
  address: addressSchema,
  cartId: z.string().nullable(),
  cancelledBy: orderPlacedBySchema.nullable(),
});

export type OrderDetail = z.infer<typeof orderDetailSchema>;

export const orderListSchema = z.object({
  items: z.array(orderSummarySchema),
  nextCursor: z.string().nullable(),
});

export type OrderList = z.infer<typeof orderListSchema>;

export const orderIdParamSchema = z.string().trim().min(1).max(64);
