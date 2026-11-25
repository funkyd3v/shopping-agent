'use client';

import type { ProductDetail } from '@shopping-agent/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, productApi } from '@/lib/api';
import { formatUsd } from '@/lib/money';
import { AddToCartButton } from './add-to-cart-button';
import { ProductThumb } from './product-thumb';
import { SignInPanel } from './products-browser';

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: ProductDetail }
  | { status: 'auth' }
  | { status: 'error'; message: string };

export function ProductDetailView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    productApi
      .get(id)
      .then((data) => {
        if (active) setState({ status: 'ready', data });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 401) {
          setState({ status: 'auth' });
          return;
        }
        setState({
          status: 'error',
          message:
            caught instanceof ApiError ? caught.message : 'Unable to load this product right now.',
        });
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (state.status === 'loading') {
    return (
      <div className="grid gap-8 lg:grid-cols-2" aria-hidden="true">
        <div className="card aspect-[4/3] animate-pulse bg-muted" />
        <div className="space-y-3">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-24 w-full animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (state.status === 'auth') {
    return <SignInPanel message="Sign in to view product details and add items to your cart." />;
  }

  if (state.status === 'error') {
    return (
      <div className="card space-y-4 p-8 text-center">
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <Link href="/products" className="btn btn-secondary">
          Back to products
        </Link>
      </div>
    );
  }

  const { product, reviews } = state.data;

  return (
    <div className="space-y-10">
      <Link
        href="/products"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden="true">←</span> All products
      </Link>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="card aspect-[4/3] overflow-hidden">
          <ProductThumb
            imageUrl={product.imageUrl}
            name={product.name}
            category={product.category}
          />
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {product.category}
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-balance">
              {product.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {product.ratingCount > 0
                ? `${product.ratingAvg.toFixed(1)} ★ · ${product.ratingCount} reviews`
                : 'No reviews yet'}
              <span className="mx-2 text-border">|</span>
              SKU {product.sku}
            </p>
          </div>

          <p className="font-display text-2xl font-semibold">{formatUsd(product.priceCents)}</p>

          <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>

          <p className="text-sm">
            {product.stock > 0 ? (
              <span className="text-muted-foreground">
                In stock · {product.stock} {product.stock === 1 ? 'unit' : 'units'} available
              </span>
            ) : (
              <span className="font-medium text-destructive">Out of stock</span>
            )}
          </p>

          <div className="max-w-xs">
            <AddToCartButton productId={product.id} stock={product.stock} />
          </div>
        </div>
      </div>

      <section className="card p-6" aria-labelledby="reviews-heading">
        <h2 id="reviews-heading" className="font-display text-lg font-semibold tracking-tight">
          Reviews
        </h2>
        {reviews.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No reviews yet. Be the first to share your experience.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {reviews.map((review) => (
              <li key={review.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{review.authorName}</p>
                  <p className="text-xs text-muted-foreground">{review.rating} / 5 ★</p>
                </div>
                {review.title ? (
                  <p className="mt-1 font-display text-sm font-semibold">{review.title}</p>
                ) : null}
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{review.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
