# Interfaces

REST, SSE, pages, environment, and observability.
Source: PLAN.md §11–15.

## API endpoints

```text
GET  /health                                          # API + DB (503 when DB is down)
GET  /health/chroma                                   # non-fatal Chroma readiness (always 200)

POST /auth/register | /auth/login | /auth/logout      GET /auth/me
GET  /products?q=&category=&minPrice=&maxPrice=&limit=&cursor=
GET  /products/:id

GET    /cart
POST   /cart/items              body: { productId, qty }
PATCH  /cart/items/:productId   body: { qty }          # qty 0 removes
DELETE /cart/items/:productId
DELETE /cart
POST   /cart/checkout           body: { clientRequestId }

GET  /orders?status=&limit=&cursor=                   GET /orders/:id
POST /orders/:id/cancel

POST /rag/chat      (SSE)    body: { sessionId?, clientMessageId, message }
POST /agent/chat    (SSE)    body: { sessionId?, clientMessageId, message }

GET  /sessions?kind=                                  GET /sessions/:id/messages
GET  /usage/me                                        # budgets, no UI
GET  /users/me                                        PATCH /users/me/address
```

- All routes except `/auth/*` require JWT (httpOnly cookie, 24 h, `{ sub, iat, exp }` only). `/health*` is public.
- `/health` runs `SELECT 1` and returns 503 `PROVIDER_UNAVAILABLE` when the DB is down. `/health/chroma` is a read-only probe (`getCollection` + metadata assert + count, 2 s timeout) that always returns 200 with `{ status: 'ok' | 'unavailable', collection, chunkCount, latencyMs, error? }`; Chroma being down degrades `/help` only.
- `clientMessageId` required on both chat endpoints; `clientRequestId` required on `/cart/checkout`.
- Ownership checks on every resource: another user's resource returns 404.
- Session `kind` must match the endpoint (`rag` vs `agent`).
- Cancel is idempotent.
- Input limits: message ≤2000, query ≤200, items ≤10, qty ≤5, cart lines ≤20.
- Pagination: `limit` (20, max 100) + cursor; products use limit/offset.
- **Implemented:** in-process fixed-window rate limiting (`common/guards/rate-limit.guard.ts`) keyed by authenticated user (or IP on public routes): auth 10, chat 20, cart 60, checkout 10 per minute; unclassified routes use the cart limit. Exceeding a bucket returns JSON `429 RATE_LIMITED` via `AllExceptionsFilter`.
- Error codes in `packages/shared/errors.ts` (`AUTH_REQUIRED`, `BUDGET_EXHAUSTED`, `PROVIDER_UNAVAILABLE`, `LLM_MODE_NO_CASSETTE`, `DB_BUSY`, `ORDER_LIMIT`, `CART_EMPTY`, `OUT_OF_STOCK`, `NO_ADDRESS`, `NEEDS_CLARIFICATION`, ...). REST errors are JSON; SSE guardrail refusals are assistant text. `DB_BUSY` is a 503 after one busy-DB retry.
- CSRF: `SameSite=Lax/Strict`, `Origin` check, strict CORS; **helmet is registered in `main.ts`**.
- Per-run SSE deadline `RUN_DEADLINE_MS` (default 90 s): server-side timeout emits a friendly `PROVIDER_UNAVAILABLE` error + `done { status: 'error' }`; a client Stop still ends the stream silently.

## SSE

Events (zod-validated in `packages/shared/events.ts`):

| Event | Payload | Use |
|---|---|---|
| `message_start` | `{ messageId, sessionId, runId }` | Client learns IDs |
| `status` | `{ phase: 'thinking' \| 'generating' }` | Spinner |
| `token` | `{ text }` | Append assistant text |
| `error` | `{ code, message, retryable, requestId }` | Friendly error |
| `done` | `{ messageId, sessionId, runId, status, usage? }` | End of stream |
| `ping` | `{}` | Keepalive ~15 s |

Lifecycle:

- `clientMessageId` required; reuse on retry.
- Existing completed turn for `(session_id, client_message_id)` → replay stored result (no duplicate side effects). In-progress → 409. User message exists but turn incomplete → reuse `turnId`, re-run, do not duplicate the user message.
- Create/verify session, acquire per-session lock, persist user message, then run.
- Persist final assistant message **before** streaming; disconnect does not lose the receipt.
- Abort before completion: persist no assistant message; user message remains; UI shows "Stopped". A committed order/cart action stands.
- `@Sse()` is GET-only; use `@Post()` + `@Res()` raw response, `flushHeaders()`, manual `write()`. Headers: `text/event-stream; charset=utf-8`, `no-cache, no-transform`, `keep-alive`, `X-Accel-Buffering: no`; disable compression; `res.on('close')` aborts and releases the lock in `finally`.

## Pages

| Route | Purpose |
|---|---|
| `/login`, `/register` | Auth; registration includes an address |
| `/products`, `/products/:id` | Catalog with Add to cart |
| `/cart` | Lines, qty stepper 1–5, remove, subtotal, warnings, Checkout |
| `/orders`, `/orders/:id` | Orders; AI badge; "From cart"; Cancel while cancellable |
| `/help` | RAG chat (plain text + text sources) |
| `/assistant` | Agent chat (plain text, acts directly) |

No agent-specific UI: no cards, trace panels, meters, or confirmation dialogs.

Chat UI: `fetch` POST + `ReadableStream` reader; robust SSE parser (partial frames, `\r\n`); validate every event with zod; spinner after `message_start`/`status`; autoscroll; disable input while running; Stop/abort; resume last session from `localStorage` or `GET /sessions`; load history; sanitize markdown (no raw HTML, no `javascript:`/`data:`, validate relative links, `rel="noopener noreferrer"` for external).

Next.js rewrites `/api/*` to NestJS so cookies are same-origin.

## Environment

`PLAN.md` §15 is the full list. Key groups:

- App: `NODE_ENV`, `PORT`, `WEB_ORIGIN`, `LOG_LEVEL`, `LOG_PROMPTS`.
- Auth: `JWT_SECRET`, `COOKIE_SECURE`.
- LLM: `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `LLM_MODE`, `PROVIDER_DISABLE`, `PROVIDER_DAILY_TOKEN_BUDGET`.
- Chroma/embeddings: `CHROMA_URL`, `CHROMA_COLLECTION`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIM`.
- RAG retrieval: `RAG_TOP_K` (5, max 10), `RAG_MAX_DISTANCE` (0.38 cosine distance; calibrate with `pnpm eval:rag`).
- DB: `DATABASE_URL`, `CHECKPOINT_DATABASE_PATH`.
- Limits: `MAX_ORDER_USD`, `MAX_QTY_PER_ITEM`, `MAX_AGENT_ORDERS_PER_DAY`, `MAX_AGENT_SPEND_PER_DAY_USD`, `CANCEL_WINDOW_MINUTES`, `MAX_CART_LINES`.
- Budgets: `REQUEST_TOKEN_BUDGET`, `SESSION_TOKEN_BUDGET`, `DAILY_TOKEN_BUDGET`.
- Streaming/input: `STREAM_MODE=buffered`, `MAX_MESSAGE_CHARS`, `RUN_DEADLINE_MS` (90 s).
- Rate limits: `RATE_LIMIT_AUTH`, `RATE_LIMIT_CHAT`, `RATE_LIMIT_CART`, `RATE_LIMIT_CHECKOUT`.

Policy file provides defaults; env overrides; zod validates at startup.

## Observability

- pino structured logs with `requestId`, `sessionId`, `runId`, `userId` (internal), agent, route, model, provider, duration, guardrail outcome. Redact cookies, authorization, prompts, PII.
- DB tables: `agent_runs`, `token_usage`, `guardrail_events`.
- Optional `pnpm run:inspect <runId>` timeline.
- Optional `/metrics` or daily summary script.
- Quality is measured by local evals, not external tracing.
