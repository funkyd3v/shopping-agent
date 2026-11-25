import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AddCartItemInput,
  Cart,
  CartLimits,
  UpdateCartItemInput,
} from '@shopping-agent/shared';
import { ulid } from 'ulid';
import { getEnv } from '../config/env';
import { PrismaService } from '../db/prisma.service';
import { buildCartView } from './cart.mapper';

/**
 * DB-backed cart, shared by REST now and agent tools in Phase 5 (PLAN §9.1).
 * One cart per user, created lazily; the cart row survives clearing.
 */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  limits(): CartLimits {
    const env = getEnv();
    return {
      maxLines: env.MAX_CART_LINES,
      maxQtyPerItem: env.MAX_QTY_PER_ITEM,
      maxOrderCents: env.MAX_ORDER_USD * 100,
    };
  }

  async getCart(userId: string): Promise<Cart> {
    this.assertUser(userId);
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          orderBy: { addedAt: 'asc' },
          include: { product: true },
        },
      },
    });
    return buildCartView(cart, this.limits());
  }

  async addItem(userId: string, input: AddCartItemInput): Promise<Cart> {
    this.assertUser(userId);
    const limits = this.limits();
    if (input.qty < 1 || input.qty > limits.maxQtyPerItem) {
      throw new BadRequestException({
        code: 'CART_LIMIT',
        message: `Quantity must be between 1 and ${limits.maxQtyPerItem}.`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: input.productId } });
      if (!product) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found.' });
      }
      if (product.stock <= 0) {
        throw new BadRequestException({
          code: 'OUT_OF_STOCK',
          message: `${product.name} is out of stock.`,
        });
      }

      const cart = await tx.cart.upsert({
        where: { userId },
        update: {},
        create: { id: ulid(), userId },
      });

      const existing = await tx.cartItem.findUnique({
        where: { cartId_productId: { cartId: cart.id, productId: product.id } },
      });

      if (!existing) {
        const lineCount = await tx.cartItem.count({ where: { cartId: cart.id } });
        if (lineCount >= limits.maxLines) {
          throw new BadRequestException({
            code: 'CART_LIMIT',
            message: `Your cart already has the maximum of ${limits.maxLines} lines.`,
          });
        }
        if (product.stock < input.qty) {
          throw new BadRequestException({
            code: 'OUT_OF_STOCK',
            message: `Only ${product.stock} of ${product.name} ${product.stock === 1 ? 'is' : 'are'} available.`,
          });
        }
        await tx.cartItem.create({
          data: {
            id: ulid(),
            cartId: cart.id,
            productId: product.id,
            qty: input.qty,
            priceAtAddCents: product.priceCents,
          },
        });
      } else {
        const nextQty = Math.min(existing.qty + input.qty, limits.maxQtyPerItem);
        if (product.stock < nextQty) {
          throw new BadRequestException({
            code: 'OUT_OF_STOCK',
            message: `Only ${product.stock} of ${product.name} ${product.stock === 1 ? 'is' : 'are'} available.`,
          });
        }
        await tx.cartItem.update({ where: { id: existing.id }, data: { qty: nextQty } });
      }

      await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    });

    return this.getCart(userId);
  }

  async updateItem(userId: string, productId: string, input: UpdateCartItemInput): Promise<Cart> {
    this.assertUser(userId);
    const limits = this.limits();
    if (input.qty > limits.maxQtyPerItem) {
      throw new BadRequestException({
        code: 'CART_LIMIT',
        message: `Quantity must be between 0 and ${limits.maxQtyPerItem}.`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({ where: { userId } });
      const item = cart
        ? await tx.cartItem.findUnique({
            where: { cartId_productId: { cartId: cart.id, productId } },
          })
        : null;
      if (!cart || !item) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Cart item not found.' });
      }

      if (input.qty === 0) {
        await tx.cartItem.delete({ where: { id: item.id } });
      } else {
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found.' });
        }
        if (product.stock < input.qty) {
          throw new BadRequestException({
            code: 'OUT_OF_STOCK',
            message: `Only ${product.stock} of ${product.name} ${product.stock === 1 ? 'is' : 'are'} available.`,
          });
        }
        await tx.cartItem.update({ where: { id: item.id }, data: { qty: input.qty } });
      }

      await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    });

    return this.getCart(userId);
  }

  async removeItem(userId: string, productId: string): Promise<Cart> {
    this.assertUser(userId);
    await this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({ where: { userId } });
      const item = cart
        ? await tx.cartItem.findUnique({
            where: { cartId_productId: { cartId: cart.id, productId } },
          })
        : null;
      if (!cart || !item) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Cart item not found.' });
      }
      await tx.cartItem.delete({ where: { id: item.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    });
    return this.getCart(userId);
  }

  async clear(userId: string): Promise<Cart> {
    this.assertUser(userId);
    await this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({ where: { userId } });
      if (!cart) return;
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    });
    return this.getCart(userId);
  }

  private assertUser(userId: string): void {
    if (!userId) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
      });
    }
  }
}
