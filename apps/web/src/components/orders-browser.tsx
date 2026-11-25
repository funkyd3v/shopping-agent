'use client';

import type { OrderStatus, OrderSummary } from '@shopping-agent/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiError, orderApi } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { formatUsd } from '@/lib/money';
import { OrderStatusBadge } from './order-status-badge';
import { SignInPanel } from './products-browser';

type StatusFilter = OrderStatus | 'all';

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'placed', label: 'Placed' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PAGE_SIZE = 20;

export function OrdersBrowser() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string>();

  // Guards against a filter change landing a stale page into the new list.
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setLoading(true);
    setLoadingMore(false);
    setError(undefined);
    setOrders([]);
    setNextCursor(null);

    orderApi
      .list({ status: status === 'all' ? undefined : status, limit: PAGE_SIZE })
      .then((page) => {
        if (!active || current !== generation.current) return;
        setOrders(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((caught: unknown) => {
        if (!active || current !== generation.current) return;
        if (caught instanceof ApiError && caught.status === 401) setAuthRequired(true);
        else setError('Unable to load your orders right now. Please try again.');
      })
      .finally(() => {
        if (active && current === generation.current) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [status]);

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    setError(undefined);
    try {
      const page = await orderApi.list({
        status: status === 'all' ? undefined : status,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      if (current !== generation.current) return;
      setOrders((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      if (current !== generation.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Unable to load more orders right now. Please try again.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  if (authRequired) {
    return <SignInPanel message="Sign in to see your orders and their status." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Your orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loading
            ? 'Loading your order history…'
            : orders.length === 0
              ? 'No orders to show.'
              : `${orders.length} ${orders.length === 1 ? 'order' : 'orders'} shown${nextCursor ? ' so far' : ''}.`}
        </p>
      </div>

      <fieldset className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
        <legend className="sr-only">Filter orders by status</legend>
        {FILTERS.map((filter) => {
          const active = filter.value === status;
          return (
            <button
              key={filter.value}
              type="button"
              aria-pressed={active}
              onClick={() => setStatus(filter.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary text-on-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </fieldset>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/25 bg-destructive-soft p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <OrdersSkeleton />
      ) : orders.length === 0 && !error ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {status === 'all'
              ? 'You have not placed any orders yet.'
              : `You have no ${status} orders.`}
          </p>
          <Link href="/products" className="btn btn-primary mt-5">
            Browse products
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-3">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  className="card flex flex-col gap-3 p-5 transition-colors hover:border-accent/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-base font-semibold tracking-tight">
                        {order.orderNumber}
                      </span>
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Placed {formatDate(order.createdAt)} · {order.itemCount}{' '}
                      {order.itemCount === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-1">
                    <span className="font-display text-base font-semibold tabular-nums">
                      {formatUsd(order.totalCents)}
                    </span>
                    <span className="text-xs font-medium text-accent">View details →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {nextCursor ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="btn btn-secondary px-5 text-sm"
              >
                {loadingMore ? 'Loading…' : 'Load more orders'}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function OrdersSkeleton() {
  return (
    <ul className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <li key={index} className="card flex flex-col gap-3 p-5 sm:flex-row sm:justify-between">
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-48 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}
