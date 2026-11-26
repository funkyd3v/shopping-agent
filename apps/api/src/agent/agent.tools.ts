import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  type Cart,
  ORDER_STATUSES,
  type OrderDetail,
  type OrderStatus,
} from '@shopping-agent/shared';
import { z } from 'zod';
import { CartService } from '../cart/cart.service';
import { ProductSearchService, type ReviewSort } from '../catalog/product-search.service';
import { formatUsd } from '../common/money';
import { CheckoutService } from '../orders/checkout.service';
import { OrderService } from '../orders/order.service';
import type { OrderRefusal } from '../orders/order-limits';
import { OrderRefusalError } from '../orders/order-write.service';
import {
  type CartIntent,
  cartToListedProducts,
  cartToSummary,
  parseCartIntent,
} from './agent.cart';
import {
  type OrderClarification,
  type OrderIntent,
  type OrderLine,
  parseOrderIntent,
} from './agent.order';
import { AGENT_COPY, AGENT_POLICY } from './agent.policy';
import type {
  AgentRoute,
  LastCartSummary,
  LastOrder,
  ListedProduct,
  OrderFooterItem,
  ProductFooterItem,
  ToolCallRecord,
} from './agent.types';
import { scanUntrustedText } from './agent.untrusted';

export type AgentToolSpec = {
  name: string;
  description: string;
  schema: z.ZodType;
};

export type ToolContext = {
  userId: string;
  sessionId: string;
  turnId: string;
  /** Server-derived from the authenticated turn; never supplied by the model. */
  clientMessageId: string;
  message: string;
  lastListedProducts: ListedProduct[];
  lastOrder: LastOrder;
};

export type ToolExecution = {
  record: ToolCallRecord;
  /** JSON envelope sent back to the model as a tool message. */
  message: string;
  lastListedProducts?: ListedProduct[];
  lastOrder?: LastOrder;
  /** Present only when a cart tool completed; empty carts are still a summary. */
  cartSummary?: LastCartSummary;
  products?: ProductFooterItem[];
  orders?: OrderFooterItem[];
  flagged?: number;
  reviewCount?: number;
  /** Deterministic reply when the model is unavailable or skipped. */
  fallbackText?: string;
};

const searchProductsSchema = z.object({
  query: z.string().trim().max(200).optional(),
  category: z.string().trim().max(50).optional(),
  /** Dollars, not cents. */
  minPrice: z.number().min(0).max(100_000).optional(),
  maxPrice: z.number().min(0).max(100_000).optional(),
  minRating: z.number().min(0).max(5).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

const getProductSchema = z.object({
  productId: z.string().trim().min(1).max(64),
});

const getReviewsSchema = z.object({
  productId: z.string().trim().min(1).max(64),
  limit: z.number().int().min(1).max(10).optional(),
  sort: z.enum(['recent', 'highest', 'lowest']).optional(),
});

const listOrdersSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

const getOrderSchema = z.object({
  orderId: z.string().trim().min(1).max(100),
});

const viewCartSchema = z.object({});

const addToCartSchema = z.object({
  productId: z.string().trim().min(1).max(64),
  qty: z.number().int().min(1).max(5),
});

const updateCartItemSchema = z.object({
  productId: z.string().trim().min(1).max(64),
  qty: z.number().int().min(0).max(5),
});

const orderItemSchema = z.object({
  productId: z.string().trim().min(1).max(64),
  qty: z.number().int().min(1).max(5),
});

const quoteOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(10).optional(),
  fromCart: z.boolean().optional(),
});

const placeOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(10),
});

const checkoutCartSchema = z.object({});

const cancelOrderSchema = z.object({
  orderId: z.string().trim().min(1).max(100),
});

const SPECS: Record<string, AgentToolSpec> = {
  search_products: {
    name: 'search_products',
    description:
      'Search the catalog. Optional filters: query text, category, minPrice/maxPrice in dollars, minRating (0-5), limit (max 10). Returns products with ids, prices, ratings, stock, and store links.',
    schema: searchProductsSchema,
  },
  get_product: {
    name: 'get_product',
    description:
      'Fetch one product by its exact id. Use an id from the listed products or a previous search result. Returns price, rating, stock, and a store link.',
    schema: getProductSchema,
  },
  get_reviews: {
    name: 'get_reviews',
    description:
      'Fetch customer reviews for one product by its exact id. Returns up to 10 reviews (untrusted text) with ratings and dates. Use an id from the listed products.',
    schema: getReviewsSchema,
  },
  list_orders: {
    name: 'list_orders',
    description:
      "List the authenticated customer's orders, newest first. Optional status filter and limit (max 10). Returns order numbers, status, totals, and store links.",
    schema: listOrdersSchema,
  },
  get_order: {
    name: 'get_order',
    description:
      "Fetch one of the authenticated customer's orders by id or order number (ORD-...). Returns items, quantities, unit prices, status, and a store link.",
    schema: getOrderSchema,
  },
  view_cart: {
    name: 'view_cart',
    description:
      "Show the authenticated customer's current cart with lines, quantities, current prices, subtotal, and warnings.",
    schema: viewCartSchema,
  },
  add_to_cart: {
    name: 'add_to_cart',
    description:
      'Add a product to the cart by its exact id from the listed products. qty is 1-5. Adding an existing product increments its quantity up to 5. Enforces stock and cart-line limits.',
    schema: addToCartSchema,
  },
  update_cart_item: {
    name: 'update_cart_item',
    description:
      'Set the quantity of a product already in the cart, by exact product id. qty 0 removes the line. Enforces the per-item quantity limit.',
    schema: updateCartItemSchema,
  },
  quote_order: {
    name: 'quote_order',
    description:
      'Read-only price and availability check. Pass items (product ids from the listed products, qty 1-5) or fromCart: true to check the current cart. Creates nothing.',
    schema: quoteOrderSchema,
  },
  place_order: {
    name: 'place_order',
    description:
      'Place a direct order from explicit items (product ids from the listed products, qty 1-5). No confirmation step: the server verifies the request against the customer message, enforces limits and stock, and returns a receipt or a structured refusal. Does not touch the cart.',
    schema: placeOrderSchema,
  },
  checkout_cart: {
    name: 'checkout_cart',
    description:
      "Turn the authenticated customer's current cart into an order, repricing every line. No confirmation step: the server enforces limits and stock, clears the cart on success, and returns a receipt or a structured refusal.",
    schema: checkoutCartSchema,
  },
  cancel_order: {
    name: 'cancel_order',
    description:
      'Cancel a placed order by its order number (ORD-…). Allowed only inside the cancellation window; items are restocked. Idempotent for an already-cancelled order.',
    schema: cancelOrderSchema,
  },
};

const SEARCH_TOOLS = [SPECS.search_products, SPECS.get_product] as AgentToolSpec[];
const REVIEW_TOOLS = [SPECS.get_reviews] as AgentToolSpec[];
const CART_TOOLS = [SPECS.view_cart, SPECS.add_to_cart, SPECS.update_cart_item] as AgentToolSpec[];
const ORDER_TOOLS = [
  SPECS.quote_order,
  SPECS.place_order,
  SPECS.checkout_cart,
  SPECS.cancel_order,
] as AgentToolSpec[];
const HISTORY_TOOLS = [SPECS.list_orders, SPECS.get_order] as AgentToolSpec[];

/**
 * Read-only tool registry (PLAN §8.4). Identity comes from `ToolContext`,
 * never from tool arguments; all arguments are zod-validated; every result is
 * an untrusted envelope.
 */
@Injectable()
export class AgentToolRegistry {
  private readonly logger = new Logger(AgentToolRegistry.name);

  constructor(
    private readonly products: ProductSearchService,
    private readonly orders: OrderService,
    private readonly cart: CartService,
    private readonly checkout: CheckoutService,
  ) {}

  specsFor(agent: AgentRoute): AgentToolSpec[] {
    if (agent === 'search') return SEARCH_TOOLS;
    if (agent === 'review') return REVIEW_TOOLS;
    if (agent === 'cart') return CART_TOOLS;
    if (agent === 'order') return ORDER_TOOLS;
    if (agent === 'history') return HISTORY_TOOLS;
    return [];
  }

  async execute(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolExecution> {
    try {
      switch (name) {
        case 'search_products': {
          const parsed = searchProductsSchema.safeParse(rawArgs);
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.searchProducts(parsed.data);
        }
        case 'get_product': {
          const parsed = getProductSchema.safeParse(rawArgs);
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.getProduct(parsed.data.productId);
        }
        case 'get_reviews': {
          const parsed = getReviewsSchema.safeParse(rawArgs);
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.getReviews(parsed.data.productId, parsed.data.limit, parsed.data.sort);
        }
        case 'list_orders': {
          const parsed = listOrdersSchema.safeParse(rawArgs);
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.listOrders(ctx.userId, parsed.data.status, parsed.data.limit);
        }
        case 'get_order': {
          const parsed = getOrderSchema.safeParse(rawArgs);
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.getOrder(ctx.userId, parsed.data.orderId);
        }
        case 'view_cart': {
          const parsed = viewCartSchema.safeParse(rawArgs ?? {});
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.viewCart(ctx.userId);
        }
        case 'add_to_cart': {
          const parsed = addToCartSchema.safeParse(rawArgs);
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.addToCart(ctx, parsed.data);
        }
        case 'update_cart_item': {
          const parsed = updateCartItemSchema.safeParse(rawArgs);
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.updateCartItem(ctx, parsed.data);
        }
        case 'quote_order': {
          const parsed = quoteOrderSchema.safeParse(rawArgs ?? {});
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.quoteOrder(ctx, parsed.data);
        }
        case 'place_order': {
          const parsed = placeOrderSchema.safeParse(rawArgs);
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.placeOrder(ctx, parsed.data);
        }
        case 'checkout_cart': {
          const parsed = checkoutCartSchema.safeParse(rawArgs ?? {});
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.checkoutCart(ctx);
        }
        case 'cancel_order': {
          const parsed = cancelOrderSchema.safeParse(rawArgs);
          if (!parsed.success) return invalidArguments(name, parsed.error.issues);
          return await this.cancelOrder(ctx, parsed.data.orderId);
        }
        default:
          return errorResult(name, 'UNKNOWN_TOOL', 'That tool is not available.');
      }
    } catch (error) {
      return this.fromError(name, error);
    }
  }

  private async searchProducts(args: z.infer<typeof searchProductsSchema>): Promise<ToolExecution> {
    const limit = clamp(args.limit ?? AGENT_POLICY.searchLimit, 1, AGENT_POLICY.maxSearchLimit);
    const poolLimit = args.minRating
      ? Math.min(AGENT_POLICY.maxSearchPool, Math.max(limit * 4, 20))
      : limit;

    const minRating = args.minRating;
    const result = await this.products.search({
      q: args.query,
      category: args.category,
      minPrice: args.minPrice,
      maxPrice: args.maxPrice,
      limit: poolLimit,
      offset: 0,
    });
    const filtered = (
      minRating === undefined
        ? result.items
        : result.items.filter((item) => item.ratingAvg >= minRating)
    ).slice(0, limit);

    const products: ProductFooterItem[] = filtered.map((product) => ({
      id: product.id,
      name: product.name,
      priceCents: product.priceCents,
      ratingAvg: product.ratingAvg,
      ratingCount: product.ratingCount,
    }));
    const listed: ListedProduct[] = filtered.map((product, index) => ({
      id: product.id,
      name: product.name,
      priceCents: product.priceCents,
      ratingAvg: product.ratingAvg,
      ratingCount: product.ratingCount,
      position: index + 1,
      sku: product.sku,
    }));

    return {
      record: { name: 'search_products', ok: true },
      message: envelope('catalog', {
        products: filtered.map((product, index) => ({
          position: index + 1,
          id: product.id,
          name: product.name,
          priceCents: product.priceCents,
          price: `$${(product.priceCents / 100).toFixed(2)}`,
          ratingAvg: product.ratingAvg,
          ratingCount: product.ratingCount,
          stock: product.stock,
          category: product.category,
          link: `/products/${product.id}`,
        })),
        count: filtered.length,
        applied: {
          query: args.query ?? null,
          category: args.category ?? null,
          minPrice: args.minPrice ?? null,
          maxPrice: args.maxPrice ?? null,
          minRating: args.minRating ?? null,
        },
      }),
      lastListedProducts: listed,
      products,
      fallbackText: products.length === 0 ? AGENT_COPY.noProducts : AGENT_COPY.searchFallbackIntro,
    };
  }

  private async getProduct(productId: string): Promise<ToolExecution> {
    const detail = await this.products.getById(productId);
    const product = detail.product;
    const footer: ProductFooterItem = {
      id: product.id,
      name: product.name,
      priceCents: product.priceCents,
      ratingAvg: product.ratingAvg,
      ratingCount: product.ratingCount,
    };
    return {
      record: { name: 'get_product', ok: true },
      message: envelope('catalog', {
        product: {
          id: product.id,
          name: product.name,
          category: product.category,
          priceCents: product.priceCents,
          price: `$${(product.priceCents / 100).toFixed(2)}`,
          ratingAvg: product.ratingAvg,
          ratingCount: product.ratingCount,
          stock: product.stock,
          link: `/products/${product.id}`,
        },
      }),
      lastListedProducts: [{ ...footer, position: 1, sku: product.sku }],
      products: [footer],
      fallbackText: AGENT_COPY.productFallbackIntro,
    };
  }

  private async getReviews(
    productId: string,
    limit: number | undefined,
    sort: ReviewSort | undefined,
  ): Promise<ToolExecution> {
    const take = clamp(limit ?? AGENT_POLICY.reviewLimit, 1, AGENT_POLICY.maxReviewLimit);
    const result = await this.products.listReviews(productId, take, sort ?? 'recent');

    let flagged = 0;
    const reviews = result.reviews.map((review) => {
      const title = review.title ? scanUntrustedText(review.title, 200) : null;
      const body = scanUntrustedText(review.body, 800);
      flagged += (title?.flagged ?? 0) + body.flagged;
      return {
        rating: review.rating,
        title: title?.text ?? null,
        body: body.text,
        author: review.authorName,
        createdAt: review.createdAt,
      };
    });
    const average =
      reviews.length > 0
        ? Number(
            (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(2),
          )
        : 0;

    return {
      record: { name: 'get_reviews', ok: true },
      message: envelope('catalog', {
        product: result.product,
        count: reviews.length,
        averageRating: average,
        reviews,
      }),
      flagged,
      reviewCount: reviews.length,
      fallbackText:
        reviews.length === 0
          ? AGENT_COPY.noReviews
          : `Customers rate ${result.product.name} ${average.toFixed(1)}/5 across ${reviews.length} recent review${reviews.length === 1 ? '' : 's'}.`,
    };
  }

  private async listOrders(
    userId: string,
    status: OrderStatus | undefined,
    limit: number | undefined,
  ): Promise<ToolExecution> {
    const take = clamp(limit ?? 5, 1, 10);
    const result = await this.orders.listForUser(userId, {
      ...(status ? { status } : {}),
      limit: take,
    });
    const orders: OrderFooterItem[] = result.items.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalCents: order.totalCents,
      currency: order.currency,
    }));
    const latest = result.items[0];

    return {
      record: { name: 'list_orders', ok: true },
      message: envelope('orders', {
        orders: result.items.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          totalCents: order.totalCents,
          total: `$${(order.totalCents / 100).toFixed(2)}`,
          currency: order.currency,
          itemCount: order.itemCount,
          createdAt: order.createdAt,
          cancellable: order.cancellable,
          link: `/orders/${order.id}`,
        })),
        count: result.items.length,
        nextCursor: result.nextCursor,
      }),
      orders,
      fallbackText: orders.length === 0 ? AGENT_COPY.noOrders : AGENT_COPY.historyFallbackIntro,
      ...(latest
        ? {
            lastOrder: {
              id: latest.id,
              orderNumber: latest.orderNumber,
              status: latest.status,
              totalCents: latest.totalCents,
            },
          }
        : {}),
    };
  }

  private async getOrder(userId: string, reference: string): Promise<ToolExecution> {
    const order = await this.orders.getByReferenceForUser(userId, reference);
    const footer: OrderFooterItem = {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalCents: order.totalCents,
      currency: order.currency,
    };
    return {
      record: { name: 'get_order', ok: true },
      message: envelope('orders', {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          totalCents: order.totalCents,
          total: `$${(order.totalCents / 100).toFixed(2)}`,
          currency: order.currency,
          createdAt: order.createdAt,
          cancellable: order.cancellable,
          items: order.items.map((item) => ({
            productName: item.productName,
            qty: item.qty,
            unitPriceCents: item.unitPriceCents,
            unitPrice: `$${(item.unitPriceCents / 100).toFixed(2)}`,
          })),
          link: `/orders/${order.id}`,
        },
      }),
      orders: [footer],
      fallbackText: AGENT_COPY.orderFallbackIntro,
      lastOrder: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalCents: order.totalCents,
      },
    };
  }

  private async viewCart(userId: string): Promise<ToolExecution> {
    const cart = await this.cart.getCart(userId);
    return this.cartResult(
      'view_cart',
      cart,
      cart.itemCount === 0 ? AGENT_COPY.cartEmpty : AGENT_COPY.cartFallbackIntro,
    );
  }

  private async addToCart(
    ctx: ToolContext,
    args: { productId: string; qty: number },
  ): Promise<ToolExecution> {
    const intent = parseCartIntent(ctx.message, ctx.lastListedProducts);
    const guard = this.cartIntentGuard('add_to_cart', intent, args);
    if (guard) return guard;

    const cart = await this.cart.addItem(ctx.userId, {
      productId: args.productId,
      qty: args.qty,
    });
    const line = cart.items.find((item) => item.productId === args.productId);
    return this.cartResult(
      'add_to_cart',
      cart,
      line
        ? `Added ${args.qty} × ${line.name} to your cart. Your cart now has ${line.qty}.`
        : AGENT_COPY.cartFallback,
    );
  }

  private async updateCartItem(
    ctx: ToolContext,
    args: { productId: string; qty: number },
  ): Promise<ToolExecution> {
    // The resolver needs the real cart lines for "remove the first one".
    const current = await this.cart.getCart(ctx.userId);
    const intent = parseCartIntent(
      ctx.message,
      ctx.lastListedProducts,
      cartToListedProducts(current),
    );
    const guard = this.cartIntentGuard('update_cart_item', intent, args);
    if (guard) return guard;

    const name =
      current.items.find((item) => item.productId === args.productId)?.name ?? 'that item';
    const cart = await this.cart.updateItem(ctx.userId, args.productId, { qty: args.qty });
    const line = cart.items.find((item) => item.productId === args.productId);
    return this.cartResult(
      'update_cart_item',
      cart,
      args.qty === 0
        ? `Removed ${name} from your cart.`
        : `Updated ${line?.name ?? name} to ${args.qty} in your cart.`,
    );
  }

  private cartResult(name: string, cart: Cart, fallbackText: string): ToolExecution {
    return {
      record: { name, ok: true },
      message: envelope('cart', {
        items: cart.items.map((item, index) => ({
          position: index + 1,
          productId: item.productId,
          name: item.name,
          qty: item.qty,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.lineTotalCents,
          stock: item.stock,
          priceChanged: item.priceChanged,
          outOfStock: item.outOfStock,
        })),
        itemCount: cart.itemCount,
        subtotalCents: cart.subtotalCents,
        warnings: cart.warnings.map((warning) => warning.message),
        link: '/cart',
      }),
      cartSummary: cartToSummary(cart),
      fallbackText,
    };
  }

  private cartIntentGuard(
    name: string,
    intent: CartIntent,
    args: { productId: string; qty: number },
  ): ToolExecution | null {
    if ('needsClarification' in intent) {
      return {
        record: { name, ok: false, errorCode: 'NEEDS_CLARIFICATION' },
        message: envelope('cart', {
          error: { code: 'NEEDS_CLARIFICATION', message: intent.question },
        }),
        fallbackText: intent.question,
      };
    }

    if (intent.action === 'view') return intentUnresolved(name);
    const actionMatches =
      name === 'add_to_cart' ? intent.action === 'add' : intent.action === 'update';
    if (!actionMatches || intent.product.id !== args.productId || intent.qty !== args.qty) {
      return intentUnresolved(name);
    }
    return null;
  }

  // ── order tools (PLAN §8.4, §9.3–§9.6) ────────────────────────────────────

  private async quoteOrder(
    ctx: ToolContext,
    args: { items?: OrderLine[]; fromCart?: boolean },
  ): Promise<ToolExecution> {
    const intent = parseOrderIntent(ctx.message, ctx.lastListedProducts, ctx.lastOrder);
    const guard = this.guardOrder('quote_order', intent, (resolved) => {
      if (resolved.action !== 'quote') return false;
      const fromCart = args.fromCart ?? false;
      const items = args.items ?? [];
      return resolved.fromCart === fromCart && sameItems(resolved.items, items);
    });
    if (guard) return guard;

    const quote = await this.orders.quote(
      this.orderActor(ctx),
      args.items ?? [],
      args.fromCart ?? false,
    );
    return {
      record: { name: 'quote_order', ok: true },
      message: envelope('orders', {
        quote: {
          lines: quote.lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            qty: line.qty,
            unitPriceCents: line.unitPriceCents,
            lineTotalCents: line.lineTotalCents,
            stock: line.stock,
          })),
          totalCents: quote.totalCents,
          total: formatUsd(quote.totalCents),
          ...(quote.refusal ? { refusal: refusalFields(quote.refusal) } : {}),
        },
      }),
      fallbackText:
        quote.refusal?.message ??
        `That comes to ${formatUsd(quote.totalCents)} before any order is placed.`,
    };
  }

  private async placeOrder(ctx: ToolContext, args: { items: OrderLine[] }): Promise<ToolExecution> {
    const intent = parseOrderIntent(ctx.message, ctx.lastListedProducts, ctx.lastOrder);
    const guard = this.guardOrder(
      'place_order',
      intent,
      (resolved) => resolved.action === 'place' && sameItems(resolved.items, args.items),
    );
    if (guard) return guard;

    const order = await this.orders.placeDirect({
      actor: this.orderActor(ctx),
      clientMessageId: ctx.clientMessageId,
      items: args.items,
    });
    return this.orderResult('place_order', order, AGENT_COPY.orderPlacedIntro);
  }

  private async checkoutCart(ctx: ToolContext): Promise<ToolExecution> {
    const intent = parseOrderIntent(ctx.message, ctx.lastListedProducts, ctx.lastOrder);
    const guard = this.guardOrder(
      'checkout_cart',
      intent,
      (resolved) => resolved.action === 'checkout',
    );
    if (guard) return guard;

    const order = await this.checkout.checkout(this.orderActor(ctx), ctx.clientMessageId);
    return this.orderResult('checkout_cart', order, AGENT_COPY.orderCheckoutIntro);
  }

  private async cancelOrder(ctx: ToolContext, reference: string): Promise<ToolExecution> {
    const intent = parseOrderIntent(ctx.message, ctx.lastListedProducts, ctx.lastOrder);
    const guard = this.guardOrder('cancel_order', intent, (resolved) => {
      if (resolved.action !== 'cancel') return false;
      const matchesMessage = reference.trim().toUpperCase() === resolved.reference.toUpperCase();
      // "cancel it" resolves from `lastOrder`; accept its internal id too.
      const matchesLastOrder =
        resolved.reason === 'last order' &&
        ctx.lastOrder !== null &&
        reference.trim() === ctx.lastOrder.id;
      return matchesMessage || matchesLastOrder;
    });
    if (guard) return guard;

    const order = await this.orders.cancel(this.orderActor(ctx), reference);
    return this.orderResult('cancel_order', order, AGENT_COPY.orderCancelledIntro);
  }

  /** Identity and provenance are injected; the model supplies none of them. */
  private orderActor(ctx: ToolContext) {
    return {
      userId: ctx.userId,
      placedBy: 'agent' as const,
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      clientMessageId: ctx.clientMessageId,
    };
  }

  private guardOrder(
    name: string,
    intent: OrderIntent,
    allowed: (intent: Exclude<OrderIntent, OrderClarification>) => boolean,
  ): ToolExecution | null {
    if ('needsClarification' in intent) {
      return {
        record: { name, ok: false, errorCode: 'NEEDS_CLARIFICATION' },
        message: envelope('orders', {
          error: { code: 'NEEDS_CLARIFICATION', message: intent.question },
        }),
        fallbackText: intent.question,
      };
    }
    if (!allowed(intent)) return orderIntentUnresolved(name);
    return null;
  }

  private orderResult(name: string, order: OrderDetail, fallbackText: string): ToolExecution {
    const footer: OrderFooterItem = {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalCents: order.totalCents,
      currency: order.currency,
      source: order.source,
      placedBy: order.placedBy,
      items: order.items.map((item) => ({
        name: item.productName,
        qty: item.qty,
        unitPriceCents: item.unitPriceCents,
      })),
      cancellableUntil: order.cancellableUntil,
      cancelledAt: order.cancelledAt,
      cancelledBy: order.cancelledBy,
      receipt: true,
    };
    return {
      record: { name, ok: true },
      message: envelope('orders', {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          source: order.source,
          placedBy: order.placedBy,
          totalCents: order.totalCents,
          total: formatUsd(order.totalCents),
          cancellable: order.cancellable,
          cancellableUntil: order.cancellableUntil,
          cancelledAt: order.cancelledAt,
          items: order.items.map((item) => ({
            productName: item.productName,
            qty: item.qty,
            unitPriceCents: item.unitPriceCents,
          })),
          link: `/orders/${order.id}`,
        },
      }),
      orders: [footer],
      lastOrder: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalCents: order.totalCents,
      },
      fallbackText,
    };
  }

  private fromError(name: string, error: unknown): ToolExecution {
    if (error instanceof OrderRefusalError) {
      return {
        record: { name, ok: false, errorCode: error.refusal.code },
        message: envelope('orders', { error: refusalFields(error.refusal) }),
        fallbackText: error.refusal.message,
      };
    }
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const body =
        typeof response === 'string'
          ? { message: response }
          : (response as {
              code?: string;
              message?: string;
              limit?: number;
              actual?: number;
              allowed?: number;
            });
      const code = body.code ?? 'TOOL_ERROR';
      const message =
        code === 'NOT_FOUND' && (name === 'get_order' || isOrderTool(name))
          ? AGENT_COPY.orderNotFound
          : code === 'NOT_FOUND' && name === 'get_product'
            ? AGENT_COPY.productNotFound
            : (body.message ?? 'The tool could not complete that request.');
      const source = isCartTool(name) ? 'cart' : isOrderTool(name) ? 'orders' : 'tool';
      return {
        record: { name, ok: false, errorCode: code },
        message: envelope(source, {
          error: {
            code,
            message,
            ...(isOrderTool(name)
              ? {
                  ...(body.limit !== undefined ? { limit: body.limit } : {}),
                  ...(body.actual !== undefined ? { actual: body.actual } : {}),
                  ...(body.allowed !== undefined ? { allowed: body.allowed } : {}),
                }
              : {}),
          },
        }),
        ...(isCartTool(name) || isOrderTool(name) ? { fallbackText: message } : {}),
      };
    }
    this.logger.warn(
      `agent tool ${name} failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    return errorResult(name, 'TOOL_ERROR', 'The tool could not complete that request.');
  }
}

function isCartTool(name: string): boolean {
  return name === 'view_cart' || name === 'add_to_cart' || name === 'update_cart_item';
}

function isOrderTool(name: string): boolean {
  return (
    name === 'quote_order' ||
    name === 'place_order' ||
    name === 'checkout_cart' ||
    name === 'cancel_order'
  );
}

/** Order-independent comparison of resolved vs. model-supplied lines. */
function sameItems(left: OrderLine[], right: OrderLine[]): boolean {
  if (left.length !== right.length) return false;
  const key = (items: OrderLine[]) =>
    items
      .map((item) => `${item.productId}:${item.qty}`)
      .sort()
      .join('|');
  return key(left) === key(right);
}

/** Structured refusal fields kept in the untrusted envelope for the model. */
function refusalFields(refusal: OrderRefusal): Record<string, unknown> {
  return {
    code: refusal.code,
    message: refusal.message,
    ...(refusal.limit !== undefined ? { limit: refusal.limit } : {}),
    ...(refusal.actual !== undefined ? { actual: refusal.actual } : {}),
    ...(refusal.allowed !== undefined ? { allowed: refusal.allowed } : {}),
    ...(refusal.productId ? { productId: refusal.productId } : {}),
  };
}

function orderIntentUnresolved(name: string): ToolExecution {
  return {
    record: { name, ok: false, errorCode: 'INTENT_UNRESOLVED' },
    message: envelope('orders', {
      error: {
        code: 'INTENT_UNRESOLVED',
        message: AGENT_COPY.orderIntentUnresolved,
      },
    }),
    fallbackText: AGENT_COPY.orderIntentUnresolved,
  };
}

function intentUnresolved(name: string): ToolExecution {
  return {
    record: { name, ok: false, errorCode: 'INTENT_UNRESOLVED' },
    message: envelope('cart', {
      error: { code: 'INTENT_UNRESOLVED', message: AGENT_COPY.cartIntentUnresolved },
    }),
    fallbackText: AGENT_COPY.cartIntentUnresolved,
  };
}

function envelope(source: string, data: unknown): string {
  const json = JSON.stringify({ trust: 'untrusted', source, data });
  if (json.length <= AGENT_POLICY.maxToolOutputChars) return json;
  return JSON.stringify({
    trust: 'untrusted',
    source,
    data: { truncated: true, preview: json.slice(0, AGENT_POLICY.maxToolOutputChars - 200) },
  });
}

function invalidArguments(name: string, issues: Array<{ message: string }>): ToolExecution {
  return {
    record: { name, ok: false, errorCode: 'INVALID_ARGUMENTS' },
    message: envelope('tool', {
      error: {
        code: 'INVALID_ARGUMENTS',
        message: 'The arguments did not match the tool schema. Correct them and retry.',
        issues: issues.slice(0, 5).map((issue) => issue.message),
      },
    }),
  };
}

function errorResult(name: string, code: string, message: string): ToolExecution {
  return {
    record: { name, ok: false, errorCode: code },
    message: envelope('tool', { error: { code, message } }),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
