'use client';

import type { PublicUser } from '@shopping-agent/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, authApi } from '@/lib/api';

type AccountState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: PublicUser }
  | { status: 'error' };

export function AccountMenu() {
  const router = useRouter();
  const [state, setState] = useState<AccountState>({ status: 'loading' });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    authApi
      .me(controller.signal)
      .then(({ user }) => setState({ status: 'authenticated', user }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          error instanceof ApiError && error.status === 401
            ? { status: 'anonymous' }
            : { status: 'error' },
        );
      });
    return () => controller.abort();
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authApi.logout();
      setState({ status: 'anonymous' });
      router.refresh();
    } catch {
      // Keep the current state; the existing cookie may still be usable.
    } finally {
      setSigningOut(false);
    }
  }

  if (state.status === 'authenticated') {
    const firstName = state.user.name.trim().split(/\s+/)[0] ?? state.user.name;
    return (
      <div className="flex min-h-11 items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">Hi, {firstName}</span>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="btn btn-secondary px-4 text-sm"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-11 items-center gap-2">
      <Link href="/login" className="btn btn-secondary px-4 text-sm">
        Sign in
      </Link>
      <Link href="/register" className="btn btn-primary px-4 text-sm">
        Create account
      </Link>
    </div>
  );
}
