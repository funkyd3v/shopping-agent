'use client';

import type { Cart, CartLine } from '@shopping-agent/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, cartApi } from '@/lib/api';
import { notifyCartUpdated } from '@/lib/cart-events';
import { formatUsd } from '@/lib/money';
import { ProductThumb } from './product-thumb';
import { SignInPanel } from './products-browser';

export function CartView() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    cartApi
      .get()
      .then(({ cart: next }) => {
        if (active) setCart(next);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 401) setAuthRequired(true);
        else setError('Unable to load your cart right now. Please try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function mutate(key: string, action: () => Promise<{ cart: Cart }>): Promise<void> {
    setBusy(key);
    setError(undefined);
    try {
      const { cart: next } = await action();
      setCart(next);
      notifyCartUpdated();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setAuthRequired(true);
      } else {
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Unable to update your cart right now. Please try again.',
        );
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <CartSkeleton />;
  if (authRequired) {
    return <SignInPanel message="Sign in to see your cart and keep items across visits." />;
  }
  if (!cart) {
    return (
      <p role="alert" className="card p-6 text-sm text-destructive">
        {error ?? 'Unable to load your cart.'}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Your cart</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {cart.itemCount === 0
              ? 'Your cart is empty.'
              : `${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'} across ${cart.items.length} ${cart.items.length === 1 ? 'line' : 'lines'}.`}
          </p>
        </div>
        {cart.items.length > 0 ? (
          <button
            type="button"
            onClick={() => void mutate('clear', () => cartApi.clear())}
            disabled={busy !== null}
            className="btn btn-secondary px-4 text-sm"
          >
            {busy === 'clear' ? 'Clearing…' : 'Clear cart'}
          </button>
        ) : null}
      </div>

      <p className="rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        Demo store — payments are mocked. Do not enter real personal data.
      </p>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/25 bg-destructive-soft p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {cart.items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing here yet. Browse the catalog and add something you like.
          </p>
          <Link href="/products" className="btn btn-primary mt-5">
            Browse products
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            {cart.warnings.length > 0 ? (
              <ul className="space-y-2" aria-label="Cart warnings">
                {cart.warnings.map((warning, index) => (
                  <li
                    key={`${warning.code}-${warning.productId ?? index}`}
                    className="rounded-xl border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
                  >
                    {warning.message}
                  </li>
                ))}
              </ul>
            ) : null}

            <ul className="card divide-y divide-border">
              {cart.items.map((line) => (
                <CartLineRow
                  key={line.productId}
                  line={line}
                  maxQty={cart.limits.maxQtyPerItem}
                  busy={busy === line.productId}
                  onQty={(qty) =>
                    void mutate(line.productId, () => cartApi.updateItem(line.productId, { qty }))
                  }
                  onRemove={() =>
                    void mutate(line.productId, () => cartApi.removeItem(line.productId))
                  }
                />
              ))}
            </ul>
          </div>

          <aside className="card h-fit space-y-4 p-5">
            <h2 className="font-display text-base font-semibold tracking-tight">Summary</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Items</dt>
                <dd>{cart.itemCount}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="font-medium">{formatUsd(cart.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-border pt-2">
                <dt className="font-medium">Total</dt>
                <dd className="font-display text-lg font-semibold">
                  {formatUsd(cart.subtotalCents)}
                </dd>
              </div>
            </dl>
            <button type="button" disabled className="btn btn-primary w-full">
              Checkout
            </button>
            <p className="text-xs text-muted-foreground">
              Checkout is coming soon. Your cart is saved to your account.
            </p>
            <p className="text-xs text-muted-foreground">
              Per-order limit: {formatUsd(cart.limits.maxOrderCents)} · up to{' '}
              {cart.limits.maxQtyPerItem} per item · {cart.limits.maxLines} lines.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}

function CartLineRow({
  line,
  maxQty,
  busy,
  onQty,
  onRemove,
}: {
  line: CartLine;
  maxQty: number;
  busy: boolean;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const canIncrease = line.qty < maxQty && line.stock > line.qty;

  return (
    <li className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <Link
        href={`/products/${line.productId}`}
        className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border"
      >
        <ProductThumb imageUrl={line.imageUrl} name={line.name} category={line.category} />
      </Link>

      <div className="min-w-0 flex-1 space-y-1">
        <Link
          href={`/products/${line.productId}`}
          className="font-display text-sm font-semibold hover:text-accent"
        >
          {line.name}
        </Link>
        <p className="text-xs text-muted-foreground">SKU {line.sku}</p>
        <p className="text-sm text-muted-foreground">{formatUsd(line.unitPriceCents)} each</p>
      </div>

      <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-2">
        <div className="inline-flex items-center rounded-lg border border-border bg-card">
          <button
            type="button"
            aria-label={`Decrease quantity of ${line.name}`}
            onClick={() => onQty(line.qty - 1)}
            disabled={busy || line.qty <= 1}
            className="flex size-9 items-center justify-center text-lg leading-none disabled:opacity-40"
          >
            −
          </button>
          <span aria-live="polite" className="min-w-8 text-center text-sm tabular-nums">
            {line.qty}
          </span>
          <button
            type="button"
            aria-label={`Increase quantity of ${line.name}`}
            onClick={() => onQty(line.qty + 1)}
            disabled={busy || !canIncrease}
            className="flex size-9 items-center justify-center text-lg leading-none disabled:opacity-40"
          >
            +
          </button>
        </div>

        <p className="font-display text-sm font-semibold">{formatUsd(line.lineTotalCents)}</p>

        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-destructive disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function CartSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]" aria-hidden="true">
      <div className="card space-y-4 p-5">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex gap-4">
            <div className="size-20 animate-pulse rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
      <div className="card h-48 animate-pulse bg-muted" />
    </div>
  );
}
