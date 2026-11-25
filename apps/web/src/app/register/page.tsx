import type { Metadata } from 'next';
import Link from 'next/link';
import { RegisterForm } from '@/components/register-form';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16 sm:py-20">
      <header className="space-y-2">
        <p className="text-sm font-medium text-accent">Get started</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
          One saved shipping address is required. You can update it later from your account.
        </p>
      </header>

      <div className="card p-6 sm:p-8">
        <RegisterForm />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
