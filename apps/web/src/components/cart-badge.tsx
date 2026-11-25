'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cartApi } from '@/lib/api';
import { CART_UPDATED_EVENT } from '@/lib/cart-events';

/** Header cart link with a live item-count badge (PLAN §12.1). */
export function CartBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    const load = () => {
      cartApi
        .get()
        .then(({ cart }) => {
          if (active) setCount(cart.itemCount);
        })
        .catch(() => {
          if (active) setCount(null);
        });
    };

    load();
    window.addEventListener(CART_UPDATED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(CART_UPDATED_EVENT, load);
    };
  }, []);

  return (
    <Link
      href="/cart"
      className="relative inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
      >
        <path d="M6 8h12l-1 12H7L6 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
      <span>Cart</span>
      {count !== null && count > 0 ? (
        <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
