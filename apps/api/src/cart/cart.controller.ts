import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  type AddCartItemInput,
  addCartItemSchema,
  type Cart,
  productIdParamSchema,
  type UpdateCartItemInput,
  updateCartItemSchema,
} from '@shopping-agent/shared';
import { CurrentUser, requireUserId } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CartService } from './cart.service';

@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

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
}
