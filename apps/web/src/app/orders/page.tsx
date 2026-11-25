import type { Metadata } from 'next';
import { OrdersBrowser } from '@/components/orders-browser';

export const metadata: Metadata = { title: 'Orders' };

export default function OrdersPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <OrdersBrowser />
    </div>
  );
}
