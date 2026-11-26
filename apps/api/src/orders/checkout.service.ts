import { Injectable } from '@nestjs/common';
import type { OrderDetail } from '@shopping-agent/shared';
import type { OrderActor, OrderWriteService } from './order-write.service';

/**
 * Cart → order checkout (PLAN §9.3). All policy lives in `OrderWriteService`;
 * this service only resolves the user's cart lines and derives the idempotency
 * key from the caller's `clientRequestId` (page) or `clientMessageId` (chat).
 */
@Injectable()
export class CheckoutService {
  constructor(private readonly write: OrderWriteService) {}

  checkout(actor: OrderActor, clientRequestId: string): Promise<OrderDetail> {
    return this.write.placeOrder({
      actor,
      source: 'cart',
      idempotencyKey: `cart:${clientRequestId}`,
      loadLines: async (tx) => {
        const cart = await tx.cart.findUnique({
          where: { userId: actor.userId },
          include: { items: { orderBy: { addedAt: 'asc' } } },
        });
        return {
          cartId: cart?.id ?? null,
          items: (cart?.items ?? []).map((item) => ({
            productId: item.productId,
            qty: item.qty,
          })),
        };
      },
    });
  }
}
