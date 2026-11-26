import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  type AddCartItemInput,
  addCartItemSchema,
  type Cart,
  type CheckoutRequest,
  checkoutRequestSchema,
  type OrderDetail,
  productIdParamSchema,
  type UpdateCartItemInput,
  updateCartItemSchema,
} from '@shopping-agent/shared';
import { CurrentUser, requireUserId } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CheckoutService } from '../orders/checkout.service';
import { OrderRefusalError, PAGE_SESSION_ID, toHttpException } from '../orders/order-write.service';
import { CartService } from './cart.service';

@Controller('cart')
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly checkout: CheckoutService,
  ) {}

  @Get()
  async get(@CurrentUser() ctx: { userId: string } | undefined): Promise<{ cart: Cart }> {
    return { cart: await this.cart.getCart(requireUserId(ctx)) };
  }

  @Post('items')
  async add(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Body(new ZodValidationPipe(addCartItemSchema)) body: AddCartItemInput,
  ): Promise<{ cart: Cart }> {
    return { cart: await this.cart.addItem(requireUserId(ctx), body) };
  }

  @Patch('items/:productId')
  async update(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Param('productId', new ZodValidationPipe(productIdParamSchema)) productId: string,
    @Body(new ZodValidationPipe(updateCartItemSchema)) body: UpdateCartItemInput,
  ): Promise<{ cart: Cart }> {
    return { cart: await this.cart.updateItem(requireUserId(ctx), productId, body) };
  }

  @Delete('items/:productId')
  async remove(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Param('productId', new ZodValidationPipe(productIdParamSchema)) productId: string,
  ): Promise<{ cart: Cart }> {
    return { cart: await this.cart.removeItem(requireUserId(ctx), productId) };
  }

  @Delete()
  async clear(@CurrentUser() ctx: { userId: string } | undefined): Promise<{ cart: Cart }> {
    return { cart: await this.cart.clear(requireUserId(ctx)) };
  }

  /**
   * Checkout the current cart (PLAN §9.3/§13). Identity comes from the auth
   * context; the idempotency key is derived from the caller's `clientRequestId`.
   */
  @Post('checkout')
  async checkoutCart(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Body(new ZodValidationPipe(checkoutRequestSchema)) body: CheckoutRequest,
  ): Promise<{ order: OrderDetail }> {
    try {
      const order = await this.checkout.checkout(
        {
          userId: requireUserId(ctx),
          placedBy: 'user',
          sessionId: PAGE_SESSION_ID,
          clientMessageId: body.clientRequestId,
        },
        body.clientRequestId,
      );
      return { order };
    } catch (error) {
      if (error instanceof OrderRefusalError) throw toHttpException(error);
      throw error;
    }
  }
}
