import { NotFoundException } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateEnv } from '../config/env';
import type { PrismaService } from '../db/prisma.service';
import { CartService } from './cart.service';

type FakeProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  imageUrl: string | null;
  priceCents: number;
  stock: number;
};

type FakeItem = {
  id: string;
  cartId: string;
  productId: string;
  qty: number;
  priceAtAddCents: number;
  addedAt: Date;
};

type FakeCart = {
  id: string;
  userId: string;
  items: FakeItem[];
};

/** Minimal in-memory Prisma covering the cart queries (no DB, no network). */
class FakePrisma {
  readonly products = new Map<string, FakeProduct>();
  readonly carts = new Map<string, FakeCart>();
  private seq = 0;

  addProduct(product: Partial<FakeProduct> & { id: string }): FakeProduct {
    const row: FakeProduct = {
      name: `Product ${product.id}`,
      sku: `SKU-${product.id}`,
      category: 'Audio',
      imageUrl: null,
      priceCents: 1000,
      stock: 10,
      ...product,
    };
    this.products.set(row.id, row);
    return row;
  }

  seedCart(
    userId: string,
    items: Array<{ productId: string; qty: number; priceAtAddCents?: number }>,
  ) {
    const cart: FakeCart = { id: `cart_${userId}`, userId, items: [] };
    for (const item of items) {
      const product = this.products.get(item.productId);
      if (!product) throw new Error(`seedCart: missing product ${item.productId}`);
      cart.items.push({
        id: `item_${++this.seq}`,
        cartId: cart.id,
        productId: item.productId,
        qty: item.qty,
        priceAtAddCents: item.priceAtAddCents ?? product.priceCents,
        addedAt: new Date(2026, 0, this.seq),
      });
    }
    this.carts.set(userId, cart);
    return cart;
  }

  private cartById(cartId: string): FakeCart | undefined {
    for (const cart of this.carts.values()) if (cart.id === cartId) return cart;
    return undefined;
  }

  private view(cart: FakeCart | null) {
    if (!cart) return null;
    return {
      id: cart.id,
      items: cart.items.map((item) => ({
        ...item,
        product: this.products.get(item.productId) as FakeProduct,
      })),
    };
  }

  readonly product = {
    findUnique: async ({ where }: { where: { id: string } }) => this.products.get(where.id) ?? null,
  };

  readonly cart = {
    findUnique: async ({ where }: { where: { userId: string } }) =>
      this.view(this.carts.get(where.userId) ?? null),
    upsert: async ({
      where,
      create,
    }: {
      where: { userId: string };
      create: { id: string; userId: string };
    }) => {
      let cart = this.carts.get(where.userId);
      if (!cart) {
        cart = { id: create.id, userId: where.userId, items: [] };
        this.carts.set(where.userId, cart);
      }
      return { ...cart };
    },
    update: async ({ where }: { where: { id: string } }) => {
      const cart = this.cartById(where.id);
      if (!cart) throw new Error('cart.update: missing cart');
      return { ...cart };
    },
  };

  readonly cartItem = {
    findUnique: async ({
      where,
    }: {
      where: { cartId_productId: { cartId: string; productId: string } };
    }) => {
      const { cartId, productId } = where.cartId_productId;
      return this.cartById(cartId)?.items.find((item) => item.productId === productId) ?? null;
    },
    count: async ({ where }: { where: { cartId: string } }) =>
      this.cartById(where.cartId)?.items.length ?? 0,
    create: async ({
      data,
    }: {
      data: {
        id: string;
        cartId: string;
        productId: string;
        qty: number;
        priceAtAddCents: number;
      };
    }) => {
      const cart = this.cartById(data.cartId);
      if (!cart) throw new Error('cartItem.create: missing cart');
      const item: FakeItem = { ...data, addedAt: new Date() };
      cart.items.push(item);
      return item;
    },
    update: async ({ where, data }: { where: { id: string }; data: { qty: number } }) => {
      for (const cart of this.carts.values()) {
        const item = cart.items.find((row) => row.id === where.id);
        if (item) {
          item.qty = data.qty;
          return item;
        }
      }
      throw new Error('cartItem.update: missing item');
    },
    delete: async ({ where }: { where: { id: string } }) => {
      for (const cart of this.carts.values()) {
        const index = cart.items.findIndex((row) => row.id === where.id);
        if (index >= 0) return cart.items.splice(index, 1)[0];
      }
      throw new Error('cartItem.delete: missing item');
    },
    deleteMany: async ({ where }: { where: { cartId: string } }) => {
      const cart = this.cartById(where.cartId);
      if (cart) cart.items = [];
      return { count: 0 };
    },
  };

  readonly $transaction = async <T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> => fn(this);
}

function serviceWith(prisma: FakePrisma): CartService {
  return new CartService(prisma as unknown as PrismaService);
}

beforeAll(() => {
  validateEnv({ JWT_SECRET: 'x'.repeat(32), DATABASE_URL: 'file:test.db' });
});

describe('CartService', () => {
  it('returns an empty cart with limits and no cart row', async () => {
    const cart = await serviceWith(new FakePrisma()).getCart('user_01');
    expect(cart).toMatchObject({
      id: null,
      items: [],
      subtotalCents: 0,
      itemCount: 0,
      warnings: [],
      limits: { maxLines: 20, maxQtyPerItem: 5, maxOrderCents: 20_000 },
    });
  });

  it('adds a line and computes totals from current product prices', async () => {
    const prisma = new FakePrisma();
    prisma.addProduct({ id: 'prod_01', priceCents: 2500 });
    const cart = await serviceWith(prisma).addItem('user_01', { productId: 'prod_01', qty: 2 });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ productId: 'prod_01', qty: 2, lineTotalCents: 5000 });
    expect(cart.subtotalCents).toBe(5000);
    expect(cart.itemCount).toBe(2);
  });

  it('merges a repeated add up to the per-item limit', async () => {
    const prisma = new FakePrisma();
    prisma.addProduct({ id: 'prod_01', stock: 10 });
    const service = serviceWith(prisma);
    await service.addItem('user_01', { productId: 'prod_01', qty: 3 });
    const cart = await service.addItem('user_01', { productId: 'prod_01', qty: 4 });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].qty).toBe(5);
  });

  it('allows a quantity of 5 but refuses 6', async () => {
    const prisma = new FakePrisma();
    prisma.addProduct({ id: 'prod_01', stock: 10 });
    const service = serviceWith(prisma);

    const ok = await service.addItem('user_01', { productId: 'prod_01', qty: 5 });
    expect(ok.items[0].qty).toBe(5);

    await expect(
      service.addItem('user_01', { productId: 'prod_01', qty: 6 }),
    ).rejects.toMatchObject({ response: { code: 'CART_LIMIT' } });
  });

  it('refuses a 21st line when the cart already has 20', async () => {
    const prisma = new FakePrisma();
    const items = Array.from({ length: 20 }, (_, index) => {
      const id = `prod_${String(index + 1).padStart(2, '0')}`;
      prisma.addProduct({ id });
      return { productId: id, qty: 1 };
    });
    prisma.seedCart('user_01', items);
    prisma.addProduct({ id: 'prod_21' });

    await expect(
      serviceWith(prisma).addItem('user_01', { productId: 'prod_21', qty: 1 }),
    ).rejects.toMatchObject({ response: { code: 'CART_LIMIT' } });
  });

  it('refuses an out-of-stock product and a quantity above stock', async () => {
    const prisma = new FakePrisma();
    prisma.addProduct({ id: 'prod_zero', stock: 0 });
    prisma.addProduct({ id: 'prod_low', stock: 2 });
    const service = serviceWith(prisma);

    await expect(
      service.addItem('user_01', { productId: 'prod_zero', qty: 1 }),
    ).rejects.toMatchObject({ response: { code: 'OUT_OF_STOCK' } });
    await expect(
      service.addItem('user_01', { productId: 'prod_low', qty: 3 }),
    ).rejects.toMatchObject({ response: { code: 'OUT_OF_STOCK' } });
  });

  it('returns 404 for a product in another user’s cart', async () => {
    const prisma = new FakePrisma();
    prisma.addProduct({ id: 'prod_01' });
    prisma.seedCart('user_02', [{ productId: 'prod_01', qty: 1 }]);
    const service = serviceWith(prisma);

    await expect(service.updateItem('user_01', 'prod_01', { qty: 2 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.removeItem('user_01', 'prod_01')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.carts.get('user_02')?.items[0].qty).toBe(1);
  });

  it('removes a line when the quantity is set to zero', async () => {
    const prisma = new FakePrisma();
    prisma.addProduct({ id: 'prod_01' });
    prisma.seedCart('user_01', [{ productId: 'prod_01', qty: 2 }]);
    const cart = await serviceWith(prisma).updateItem('user_01', 'prod_01', { qty: 0 });
    expect(cart.items).toEqual([]);
    expect(cart.itemCount).toBe(0);
  });

  it('refuses an update above the per-item limit and above stock', async () => {
    const prisma = new FakePrisma();
    prisma.addProduct({ id: 'prod_01', stock: 3 });
    prisma.seedCart('user_01', [{ productId: 'prod_01', qty: 1 }]);
    const service = serviceWith(prisma);

    await expect(service.updateItem('user_01', 'prod_01', { qty: 6 })).rejects.toMatchObject({
      response: { code: 'CART_LIMIT' },
    });
    await expect(service.updateItem('user_01', 'prod_01', { qty: 4 })).rejects.toMatchObject({
      response: { code: 'OUT_OF_STOCK' },
    });
  });

  it('warns when the stored price differs from the current price', async () => {
    const prisma = new FakePrisma();
    prisma.addProduct({ id: 'prod_01', priceCents: 1200 });
    prisma.seedCart('user_01', [{ productId: 'prod_01', qty: 1, priceAtAddCents: 1000 }]);
    const cart = await serviceWith(prisma).getCart('user_01');
    expect(cart.items[0].priceChanged).toBe(true);
    expect(cart.warnings).toEqual([
      expect.objectContaining({ code: 'PRICE_CHANGED', productId: 'prod_01' }),
    ]);
  });

  it('clears all lines but keeps the cart row', async () => {
    const prisma = new FakePrisma();
    prisma.addProduct({ id: 'prod_01' });
    prisma.addProduct({ id: 'prod_02' });
    prisma.seedCart('user_01', [
      { productId: 'prod_01', qty: 1 },
      { productId: 'prod_02', qty: 2 },
    ]);
    const cart = await serviceWith(prisma).clear('user_01');
    expect(cart.items).toEqual([]);
    expect(prisma.carts.get('user_01')).toBeDefined();
  });

  it('rejects a missing user before touching the database', async () => {
    const service = serviceWith(new FakePrisma());
    await expect(service.getCart('')).rejects.toMatchObject({
      response: { code: 'AUTH_REQUIRED' },
    });
  });
});
