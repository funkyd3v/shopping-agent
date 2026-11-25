import type { Product as ProductDto, Review as ReviewDto } from '@shopping-agent/shared';
import type { Product, Review } from '../generated/prisma/client';

export function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    priceCents: product.priceCents,
    stock: product.stock,
    ratingAvg: product.ratingAvg,
    ratingCount: product.ratingCount,
    imageUrl: product.imageUrl,
  };
}

export function toReviewDto(review: Review): ReviewDto {
  return {
    id: review.id,
    productId: review.productId,
    authorName: review.authorName,
    rating: review.rating,
    title: review.title,
    body: review.body,
    createdAt: review.createdAt.toISOString(),
  };
}
