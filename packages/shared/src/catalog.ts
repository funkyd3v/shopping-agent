import { z } from 'zod';

/** Catalog categories used by the seed, the REST filters, and the web UI. */
export const PRODUCT_CATEGORIES = [
  'Audio',
  'Computers',
  'Home',
  'Fitness',
  'Outdoors',
  'Accessories',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/**
 * Catalog contracts shared by REST, the web app, and (later) agent tools.
 * Prices are integer cents everywhere in the API; the `minPrice`/`maxPrice`
 * query parameters are dollars for human-friendly URLs.
 */

const optionalQueryText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional(),
  );

const optionalPrice = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v),
  z.coerce.number().nonnegative().max(1_000_000).optional(),
);

export const productListQuerySchema = z
  .object({
    q: optionalQueryText(200),
    category: optionalQueryText(50),
    /** Dollars, e.g. `25` or `25.50`. */
    minPrice: optionalPrice,
    /** Dollars, e.g. `80`. */
    maxPrice: optionalPrice,
    limit: z.preprocess(
      (v) => (v === undefined || v === '' ? 20 : v),
      z.coerce.number().int().min(1).max(50),
    ),
    offset: z.preprocess(
      (v) => (v === undefined || v === '' ? 0 : v),
      z.coerce.number().int().min(0).max(10_000),
    ),
  })
  .refine(
    (value) =>
      value.minPrice === undefined ||
      value.maxPrice === undefined ||
      value.minPrice <= value.maxPrice,
    {
      message: 'minPrice must be less than or equal to maxPrice',
      path: ['minPrice'],
    },
  );

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  priceCents: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  ratingAvg: z.number(),
  ratingCount: z.number().int().nonnegative(),
  imageUrl: z.string().nullable(),
});

export type Product = z.infer<typeof productSchema>;

export const reviewSchema = z.object({
  id: z.string(),
  productId: z.string(),
  authorName: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});

export type Review = z.infer<typeof reviewSchema>;

export const productListSchema = z.object({
  items: z.array(productSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export type ProductList = z.infer<typeof productListSchema>;

export const productDetailSchema = z.object({
  product: productSchema,
  reviews: z.array(reviewSchema),
});

export type ProductDetail = z.infer<typeof productDetailSchema>;

export const productIdParamSchema = z.string().trim().min(1).max(64);
