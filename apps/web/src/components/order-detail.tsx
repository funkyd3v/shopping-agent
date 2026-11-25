'use client';

import type { OrderDetail } from '@shopping-agent/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, orderApi } from '@/lib/api';
import { formatDateTime } from '@/lib/date';
import { formatUsd } from '@/lib/money';
import { OrderStatusBadge } from './order-status-badge';
import { SignInPanel } from './products-browser';

type State =
  | { status: 'loading' }
  | { status: 'ready'; order: OrderDetail }
  | { status: 'auth' }
  | { status: 'error'; message: string };

export function OrderDetailView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    orderApi
      .get(id)
      .then((order) => {
        if (active) setState({ status: 'ready', order });
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
            caught instanceof ApiError
              ? caught.message
              : 'Unable to load this order right now. Please try again.',
        });
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (state.status === 'loading') return <OrderDetailSkeleton />;
  if (state.status === 'auth') {
    return <SignInPanel message="Sign in to see the details of this order." />;
  }
  if (state.status === 'error') {
    return (
      <div className="card space-y-4 p-8 text-center">
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <Link href="/orders" className="btn btn-secondary">
          Back to orders
        </Link>
      </div>
    );
  }

  const { order } = state;
  const { address } = order;

  return (
    <div className="space-y-6">
      <Link
        href="/orders"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden="true">←</span> All orders
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Order {order.orderNumber}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed {formatDateTime(order.createdAt)}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </header>

      {order.status === 'cancelled' && order.cancelledAt ? (
        <p className="rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Cancelled {formatDateTime(order.cancelledAt)}
          {order.cancelledBy
            ? ` by ${order.cancelledBy === 'agent' ? 'the assistant' : 'you'}`
            : ''}
          .
        </p>
      ) : null}

      {order.cancellable && order.cancellableUntil ? (
        <p className="rounded-xl border border-accent/20 bg-accent-soft px-4 py-3 text-sm text-accent">
          This order can be cancelled until {formatDateTime(order.cancellableUntil)}.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="card" aria-labelledby="order-items-heading">
          <h2
            id="order-items-heading"
            className="border-b border-border p-5 font-display text-base font-semibold tracking-tight"
          >
            Items
          </h2>
          <ul className="divide-y divide-border">
            {order.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/products/${item.productId}`}
                    className="font-display text-sm font-semibold hover:text-accent"
                  >
                    {item.productName}
                  </Link>
                  <p className="text-xs text-muted-foreground">SKU {item.sku}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.qty} × {formatUsd(item.unitPriceCents)}
                  </p>
                </div>
                <p className="font-display text-sm font-semibold tabular-nums">
                  {formatUsd(item.qty * item.unitPriceCents)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-6">
          <section className="card p-5" aria-labelledby="order-summary-heading">
            <h2
              id="order-summary-heading"
              className="font-display text-base font-semibold tracking-tight"
            >
              Summary
            </h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Items</dt>
                <dd>{order.itemCount}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-border pt-2">
                <dt className="font-medium">Total</dt>
                <dd className="font-display text-lg font-semibold tabular-nums">
                  {formatUsd(order.totalCents)}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Demo order — payments are mocked and no real charge was made.
            </p>
          </section>

          <section className="card p-5" aria-labelledby="order-address-heading">
            <h2
              id="order-address-heading"
              className="font-display text-base font-semibold tracking-tight"
            >
              Shipping address
            </h2>
            <address className="mt-3 text-sm leading-relaxed text-muted-foreground not-italic">
              {address.line1}
              <br />
              {address.line2 ? (
                <>
                  {address.line2}
                  <br />
                </>
              ) : null}
              {address.city}
              {address.region ? `, ${address.region}` : ''} {address.postalCode}
              <br />
              {address.country}
            </address>
          </section>
        </aside>
      </div>
    </div>
  );
}

function OrderDetailSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="h-9 w-64 animate-pulse rounded bg-muted" />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="card h-64 animate-pulse bg-muted" />
        <div className="card h-48 animate-pulse bg-muted" />
      </div>
    </div>
  );
}
