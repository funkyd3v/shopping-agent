import { Controller, Get, Param, Query } from '@nestjs/common';
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
}
