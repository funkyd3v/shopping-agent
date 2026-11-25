import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-6 py-16 sm:py-24">
      <header className="space-y-2">
        <p className="text-sm font-medium text-accent">Welcome back</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Access your cart, orders, and conversations.
        </p>
      </header>

      <div className="card p-6 sm:p-8">
        <LoginForm />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link
          href="/register"
          className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
