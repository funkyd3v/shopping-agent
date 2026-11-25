import type { Metadata } from 'next';
import { ProductDetailView } from '@/components/product-detail';

export const metadata: Metadata = { title: 'Product' };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <ProductDetailView id={id} />
    </div>
  );
}
