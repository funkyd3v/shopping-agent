import type { Metadata } from 'next';
import { OrderDetailView } from '@/components/order-detail';

export const metadata: Metadata = { title: 'Order' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <OrderDetailView id={id} />
    </div>
  );
}
