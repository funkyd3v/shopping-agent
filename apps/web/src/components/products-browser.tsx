'use client';

import { PRODUCT_CATEGORIES, type Product, type ProductList } from '@shopping-agent/shared';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, productApi } from '@/lib/api';
import { formatUsd } from '@/lib/money';
import { AddToCartButton } from './add-to-cart-button';
import { ProductThumb } from './product-thumb';

type Filters = {
  q: string;
  category: string;
  minPrice: string;
  maxPrice: string;
};

const EMPTY_FILTERS: Filters = { q: '', category: '', minPrice: '', maxPrice: '' };

function toQuery(filters: Filters, offset: number) {
  return {
    q: filters.q.trim() || undefined,
    category: filters.category || undefined,
    minPrice: filters.minPrice.trim() || undefined,
    maxPrice: filters.maxPrice.trim() || undefined,
    limit: 20,
    offset,
  };
}

export function ProductsBrowser() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [data, setData] = useState<ProductList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [authRequired, setAuthRequired] = useState(false);

  const load = useCallback(async (next: Filters, offset = 0, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(undefined);
    setAuthRequired(false);
    try {
      const result = await productApi.list(toQuery(next, offset));
      setData((previous) =>
        append && previous ? { ...result, items: [...previous.items, ...result.items] } : result,
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setAuthRequired(true);
      } else {
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Unable to load products right now. Please try again.',
        );
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(EMPTY_FILTERS);
  }, [load]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void load(filters);
  }

  function handleClear(): void {
    setFilters(EMPTY_FILTERS);
    void load(EMPTY_FILTERS);
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1.5 lg:col-span-2">
            <span className="block text-sm font-medium">Search</span>
            <input
              type="search"
              value={filters.q}
              maxLength={200}
              placeholder="headphones, tent, coffee…"
              onChange={(event) => setFilters({ ...filters, q: event.target.value })}
              className="field-input"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-sm font-medium">Category</span>
            <select
              value={filters.category}
              onChange={(event) => setFilters({ ...filters, category: event.target.value })}
              className="field-input"
            >
              <option value="">All categories</option>
              {PRODUCT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-sm font-medium">Min price ($)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={filters.minPrice}
              onChange={(event) => setFilters({ ...filters, minPrice: event.target.value })}
              className="field-input"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-sm font-medium">Max price ($)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={filters.maxPrice}
              onChange={(event) => setFilters({ ...filters, maxPrice: event.target.value })}
              className="field-input"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading ? 'Searching…' : 'Search products'}
          </button>
          <button type="button" onClick={handleClear} className="btn btn-secondary">
            Clear filters
          </button>
        </div>
      </form>

      {authRequired ? (
        <SignInPanel message="Sign in to browse the catalog and add items to your cart." />
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/25 bg-destructive-soft p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {loading && !data ? <ProductGridSkeleton /> : null}

      {data && !authRequired ? (
        <section className="space-y-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-semibold tracking-tight">
              {data.total === 0 ? 'No products found' : `${data.total} products`}
            </h2>
            {data.total > 0 ? (
              <p className="text-sm text-muted-foreground">
                Showing {data.items.length} of {data.total}
              </p>
            ) : null}
          </div>

          {data.items.length === 0 ? (
            <div className="card p-8 text-center text-sm text-muted-foreground">
              <p>Try a different search term, category, or price range.</p>
              <button type="button" onClick={handleClear} className="btn btn-secondary mt-4">
                Clear filters
              </button>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((product) => (
                <li key={product.id}>
                  <ProductCard product={product} />
                </li>
              ))}
            </ul>
          )}

          {data.items.length < data.total ? (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => void load(filters, data.items.length, true)}
                disabled={loadingMore}
                className="btn btn-secondary"
              >
                {loadingMore ? 'Loading…' : 'Load more products'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <article className="card flex h-full flex-col overflow-hidden">
      <Link
        href={`/products/${product.id}`}
        className="block aspect-[4/3] overflow-hidden border-b border-border"
      >
        <ProductThumb imageUrl={product.imageUrl} name={product.name} category={product.category} />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {product.category}
        </p>
        <h3 className="font-display text-base leading-snug font-semibold tracking-tight">
          <Link href={`/products/${product.id}`} className="hover:text-accent">
            {product.name}
          </Link>
        </h3>
        <p className="text-xs text-muted-foreground">
          {product.ratingCount > 0
            ? `${product.ratingAvg.toFixed(1)} ★ · ${product.ratingCount} reviews`
            : 'No reviews yet'}
        </p>
        <p className="mt-auto font-display text-lg font-semibold">
          {formatUsd(product.priceCents)}
        </p>
        <AddToCartButton productId={product.id} stock={product.stock} />
      </div>
    </article>
  );
}

function ProductGridSkeleton() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <li key={index} className="card overflow-hidden">
          <div className="aspect-[4/3] animate-pulse bg-muted" />
          <div className="space-y-2 p-4">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-11 w-full animate-pulse rounded-xl bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SignInPanel({ message }: { message: string }) {
  return (
    <div className="card p-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/login" className="btn btn-primary">
          Sign in
        </Link>
        <Link href="/register" className="btn btn-secondary">
          Create account
        </Link>
      </div>
    </div>
  );
}
