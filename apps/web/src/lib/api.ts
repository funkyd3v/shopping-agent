import type { LoginInput, PublicUser, RegisterInput } from '@shopping-agent/shared';
import type { FieldIssue } from './form-errors';

type ErrorBody = {
  code?: string;
  message?: string;
  issues?: FieldIssue[];
  requestId?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: FieldIssue[];

  constructor(message: string, status: number, code: string, issues: FieldIssue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** Browser-side calls go through the Next /api rewrite so the auth cookie stays same-origin. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const body = (data ?? {}) as ErrorBody;
    throw new ApiError(
      body.message ?? 'Something went wrong. Please try again.',
      response.status,
      body.code ?? 'INTERNAL_ERROR',
      body.issues ?? [],
    );
  }

  return data as T;
}

export const authApi = {
  login: (input: LoginInput) =>
    request<{ user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  register: (input: RegisterInput) =>
    request<{ user: PublicUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  me: (signal?: AbortSignal) => request<{ user: PublicUser }>('/api/auth/me', { signal }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
};
