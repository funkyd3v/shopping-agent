import type {
  AddCartItemInput,
  Cart,
  ChatMessagesResponse,
  ChatRequest,
  ChatSessionKind,
  ChatSessionList,
  LoginInput,
  OrderDetail,
  OrderList,
  OrderStatus,
  ProductDetail,
  ProductList,
  PublicUser,
  RegisterInput,
  UpdateCartItemInput,
} from '@shopping-agent/shared';
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

export type ProductQuery = {
  q?: string;
  category?: string;
  /** Dollars, as accepted by GET /products. */
  minPrice?: string;
  maxPrice?: string;
  limit?: number;
  offset?: number;
};

export const productApi = {
  list: (query: ProductQuery = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return request<ProductList>(`/api/products${suffix}`);
  },

  get: (id: string) => request<ProductDetail>(`/api/products/${encodeURIComponent(id)}`),
};

export const cartApi = {
  get: () => request<{ cart: Cart }>('/api/cart'),

  addItem: (input: AddCartItemInput) =>
    request<{ cart: Cart }>('/api/cart/items', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateItem: (productId: string, input: UpdateCartItemInput) =>
    request<{ cart: Cart }>(`/api/cart/items/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  removeItem: (productId: string) =>
    request<{ cart: Cart }>(`/api/cart/items/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
    }),

  clear: () => request<{ cart: Cart }>('/api/cart', { method: 'DELETE' }),
};

export type OrderQuery = {
  status?: OrderStatus;
  limit?: number;
  cursor?: string;
};

export const orderApi = {
  list: (query: OrderQuery = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return request<OrderList>(`/api/orders${suffix}`);
  },

  get: (id: string) => request<OrderDetail>(`/api/orders/${encodeURIComponent(id)}`),
};

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

export const chatApi = {
  sessions: (kind: 'rag' | 'agent', signal?: AbortSignal) =>
    request<ChatSessionList>(`/api/sessions?kind=${kind}&limit=1`, { signal }),

  messages: (sessionId: string, signal?: AbortSignal) =>
    request<ChatMessagesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      signal,
    }),

  /**
   * POST the turn and return the raw SSE response. Non-2xx bodies are JSON
   * (validation, auth, or 409) and are surfaced as `ApiError`.
   */
  async stream(kind: ChatSessionKind, input: ChatRequest, signal: AbortSignal): Promise<Response> {
    const response = await fetch(`/api/${kind}/chat`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(input),
      signal,
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as ErrorBody | null;
      throw new ApiError(
        data?.message ?? 'Unable to send your question right now. Please try again.',
        response.status,
        data?.code ?? 'INTERNAL_ERROR',
        data?.issues ?? [],
      );
    }

    return response;
  },
};
