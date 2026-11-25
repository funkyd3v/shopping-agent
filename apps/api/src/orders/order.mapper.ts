import {
  addressSchema,
  type OrderDetail,
  type OrderSummary,
  orderPlacedBySchema,
  orderSourceSchema,
  orderStatusSchema,
} from '@shopping-agent/shared';
import type { Order, OrderItem } from '../generated/prisma/client';

export type OrderWithItems = Order & { items: OrderItem[] };

export function toOrderSummary(order: Order, now = Date.now()): OrderSummary {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: orderStatusSchema.parse(order.status),
    source: orderSourceSchema.parse(order.source),
    placedBy: orderPlacedBySchema.parse(order.placedBy),
    totalCents: order.totalCents,
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
    cancellableUntil: order.cancellableUntil?.toISOString() ?? null,
    cancellable:
      order.status === 'placed' &&
      order.cancellableUntil !== null &&
      order.cancellableUntil.getTime() > now,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
  };
}

function parseAddressSnapshot(snapshotJson: string): OrderDetail['address'] {
  const snapshot = JSON.parse(snapshotJson) as Record<string, unknown>;
  // Optional address fields are stored as null in snapshots; normalize to the
  // shared DTO's "absent" representation before validation.
  return addressSchema.parse({
    ...snapshot,
    line2: snapshot.line2 ?? undefined,
    region: snapshot.region ?? undefined,
  });
}

export function toOrderDetail(order: OrderWithItems): OrderDetail {
  return {
    ...toOrderSummary(order),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      qty: item.qty,
      unitPriceCents: item.unitPriceCents,
    })),
    address: parseAddressSnapshot(order.addressSnapshotJson),
    cartId: order.cartId,
    cancelledBy: order.cancelledBy === null ? null : orderPlacedBySchema.parse(order.cancelledBy),
  };
}
