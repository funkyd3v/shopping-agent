import type { Metadata } from 'next';
import { ProductsBrowser } from '@/components/products-browser';

export const metadata: Metadata = { title: 'Products' };

export default function ProductsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-12">
      <header className="max-w-2xl space-y-2">
        <p className="text-sm font-medium text-accent">Catalog</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Products</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Search the store catalog by name, category, or price. Add items to your cart and manage
          quantities on the cart page.
        </p>
      </header>
      <ProductsBrowser />
    </div>
  );
}
