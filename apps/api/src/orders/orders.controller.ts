import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  type OrderDetail,
  type OrderList,
  type OrderListQuery,
  orderIdParamSchema,
  orderListQuerySchema,
} from '@shopping-agent/shared';
import { CurrentUser, requireUserId } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OrderService } from './order.service';
import { OrderRefusalError, PAGE_SESSION_ID, toHttpException } from './order-write.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  list(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery,
  ): Promise<OrderList> {
    return this.orders.listForUser(requireUserId(ctx), query);
  }

  @Get(':id')
  get(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Param('id', new ZodValidationPipe(orderIdParamSchema)) id: string,
  ): Promise<OrderDetail> {
    return this.orders.getForUser(requireUserId(ctx), id);
  }

  /** Cancel a placed order inside its window (PLAN §9.5). Idempotent. */
  @Post(':id/cancel')
  async cancel(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Param('id', new ZodValidationPipe(orderIdParamSchema)) id: string,
  ): Promise<{ order: OrderDetail }> {
    try {
      const order = await this.orders.cancel(
        { userId: requireUserId(ctx), placedBy: 'user', sessionId: PAGE_SESSION_ID },
        id,
      );
      return { order };
    } catch (error) {
      if (error instanceof OrderRefusalError) throw toHttpException(error);
      throw error;
    }
  }
}
