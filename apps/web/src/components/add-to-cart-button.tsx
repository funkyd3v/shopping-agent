'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, cartApi } from '@/lib/api';
import { notifyCartUpdated } from '@/lib/cart-events';

type AddToCartButtonProps = {
  productId: string;
  stock: number;
  className?: string;
};

export function AddToCartButton({ productId, stock, className }: AddToCartButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string>();

  async function handleAdd(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await cartApi.addItem({ productId, qty: 1 });
      notifyCartUpdated();
      setAdded(true);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 401) {
          router.push('/login');
          return;
        }
        setError(caught.message);
      } else {
        setError('Unable to add this item right now. Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  if (stock <= 0) {
    return (
      <button type="button" disabled className={`btn btn-secondary w-full ${className ?? ''}`}>
        Out of stock
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={handleAdd}
        disabled={pending}
        className={`btn btn-primary w-full ${className ?? ''}`}
      >
        {pending ? 'Adding…' : added ? 'Added to cart' : 'Add to cart'}
      </button>
      <p aria-live="polite" className="min-h-4 text-xs text-destructive">
        {error ?? ''}
      </p>
    </div>
  );
}
