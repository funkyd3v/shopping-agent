import type { Metadata } from 'next';
import { Nunito_Sans, Rubik } from 'next/font/google';
import Link from 'next/link';
import { AccountMenu } from '@/components/account-menu';
import { CartBadge } from '@/components/cart-badge';
import './globals.css';

const bodyFont = Nunito_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const headingFont = Rubik({ subsets: ['latin'], variable: '--font-heading', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'Shopping Agent',
    template: '%s · Shopping Agent',
  },
  description:
    'An AI shopping assistant for finding products, managing your cart, and tracking orders.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${headingFont.variable}`}>
      <body className="flex min-h-dvh flex-col bg-background font-sans text-foreground antialiased">
        <a
          href="#main"
          className="sr-only rounded-md bg-card px-4 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
        >
          Skip to content
        </a>

        <header className="sticky top-0 z-10 border-b border-border/80 bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-6">
            <div className="flex items-center gap-4 sm:gap-6">
              <Link
                href="/"
                className="flex items-center gap-2.5 rounded-md font-display text-base font-semibold tracking-tight"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-5"
                >
                  <path d="M6 8h12l-1 12H7L6 8Z" />
                  <path d="M9 8V6a3 3 0 0 1 6 0v2" />
                </svg>
                <span className="hidden sm:inline">Shopping Agent</span>
              </Link>
              <nav aria-label="Main" className="flex items-center gap-1">
                <Link
                  href="/products"
                  className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Products
                </Link>
                <Link
                  href="/orders"
                  className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Orders
                </Link>
                <CartBadge />
              </nav>
            </div>
            <AccountMenu />
          </div>
        </header>

        <main id="main" className="flex-1">
          {children}
        </main>

        <footer className="border-t border-border/80">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>Shopping Agent</p>
            <p>Find products, manage your cart, and track orders in plain language.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
