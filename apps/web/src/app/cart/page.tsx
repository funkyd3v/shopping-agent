import type { Metadata } from 'next';
import { CartView } from '@/components/cart-view';

export const metadata: Metadata = { title: 'Cart' };

export default function CartPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <CartView />
    </div>
  );
}
