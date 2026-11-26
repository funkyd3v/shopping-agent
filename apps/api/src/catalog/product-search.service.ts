import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ProductDetail, ProductList, ProductListQuery, Review } from '@shopping-agent/shared';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { toProductDto, toReviewDto } from './catalog.mapper';
import { dollarsToCents, toFtsMatch } from './product-search.util';

export type ReviewSort = 'recent' | 'highest' | 'lowest';

export type ProductReviews = {
  product: { id: string; name: string };
  reviews: Review[];
};

const PRODUCT_ORDER: Prisma.ProductOrderByWithRelationInput[] = [
  { ratingCount: 'desc' },
  { ratingAvg: 'desc' },
  { name: 'asc' },
];

type SearchFilters = {
  match?: string;
  category?: string;
  minCents?: number;
  maxCents?: number;
  limit: number;
  offset: number;
};

/**
 * Single source of truth for catalog reads (REST now, agent tools in Phase 4).
 * Uses SQLite FTS5 for text search with a LIKE fallback (PLAN §5).
 */
@Injectable()
export class ProductSearchService {
  private readonly logger = new Logger(ProductSearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  async search(query: ProductListQuery): Promise<ProductList> {
    const filters: SearchFilters = {
      match: toFtsMatch(query.q),
      category: query.category,
      minCents: dollarsToCents(query.minPrice),
      maxCents: dollarsToCents(query.maxPrice),
      limit: query.limit,
      offset: query.offset,
    };

    if (filters.match) {
      try {
        const fts = await this.searchFts(filters);
        if (fts.total > 0) return fts;
      } catch (error) {
        // A malformed/unsupported FTS query must never break the catalog.
        this.logger.warn(
          `FTS search failed, falling back to LIKE: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return this.searchLike({ ...filters, text: query.q });
  }

  /** Bounded review read for the review agent (PLAN §8.4). */
  async listReviews(
    productId: string,
    limit: number,
    sort: ReviewSort = 'recent',
  ): Promise<ProductReviews> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true },
    });
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found.' });
    }

    const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
      sort === 'highest'
        ? [{ rating: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }]
        : sort === 'lowest'
          ? [{ rating: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'asc' }];

    const reviews = await this.prisma.review.findMany({
      where: { productId },
      orderBy,
      take: limit,
    });
    return { product, reviews: reviews.map(toReviewDto) };
  }

  async getById(id: string): Promise<ProductDetail> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        reviews: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20 },
      },
    });
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found.' });
    }
    return {
      product: toProductDto(product),
      reviews: product.reviews.map(toReviewDto),
    };
  }

  private async searchFts(filters: SearchFilters): Promise<ProductList> {
    const conditions: Prisma.Sql[] = [Prisma.sql`products_fts MATCH ${filters.match}`];
    if (filters.category) conditions.push(Prisma.sql`p.category = ${filters.category}`);
    if (filters.minCents !== undefined)
      conditions.push(Prisma.sql`p.price_cents >= ${filters.minCents}`);
    if (filters.maxCents !== undefined)
      conditions.push(Prisma.sql`p.price_cents <= ${filters.maxCents}`);
    const where = Prisma.join(conditions, ' AND ');

    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<Array<{ product_id: string }>>(Prisma.sql`
        SELECT products_fts.product_id AS product_id
        FROM products_fts
        JOIN products AS p ON p.id = products_fts.product_id
        WHERE ${where}
        ORDER BY bm25(products_fts), p.rating_count DESC, p.name ASC
        LIMIT ${filters.limit} OFFSET ${filters.offset}
      `),
      this.prisma.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
        SELECT COUNT(*) AS count
        FROM products_fts
        JOIN products AS p ON p.id = products_fts.product_id
        WHERE ${where}
      `),
    ]);

    const total = Number(counts[0]?.count ?? 0);
    const ids = rows.map((row) => row.product_id);
    if (ids.length === 0) return { items: [], total, limit: filters.limit, offset: filters.offset };

    const products = await this.prisma.product.findMany({ where: { id: { in: ids } } });
    const byId = new Map(products.map((product) => [product.id, product]));
    const items = ids
      .map((id) => byId.get(id))
      .filter((product): product is NonNullable<typeof product> => product !== undefined)
      .map(toProductDto);

    return { items, total, limit: filters.limit, offset: filters.offset };
  }

  private async searchLike(filters: SearchFilters & { text?: string }): Promise<ProductList> {
    const where: Prisma.ProductWhereInput = {};
    if (filters.category) where.category = filters.category;
    if (filters.minCents !== undefined || filters.maxCents !== undefined) {
      where.priceCents = {
        ...(filters.minCents !== undefined ? { gte: filters.minCents } : {}),
        ...(filters.maxCents !== undefined ? { lte: filters.maxCents } : {}),
      };
    }
    if (filters.text) {
      const contains = filters.text;
      where.OR = [
        { name: { contains } },
        { description: { contains } },
        { category: { contains } },
        { sku: { contains } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: PRODUCT_ORDER,
        take: filters.limit,
        skip: filters.offset,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: products.map(toProductDto),
      total,
      limit: filters.limit,
      offset: filters.offset,
    };
  }
}
