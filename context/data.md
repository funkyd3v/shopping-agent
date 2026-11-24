# Data Model

SQLite via Prisma. All timestamps are UTC `DateTime`; all money is integer cents; IDs are ULIDs generated in the service layer.
Source: PLAN.md §5.

## Tables

| Table | Key columns |
|---|---|
| `users` | id, email (lowercased, unique), password_hash, name, created_at |
| `addresses` | id, user_id (**unique**), line1, line2?, city, region?, postal_code, country, created_at |
| `products` | id, sku (unique), name, description, category, price_cents, stock, rating_avg, rating_count, image_url, created_at |
| `products_fts` | FTS5 virtual table over name/description/category/sku; `product_id UNINDEXED`; sync triggers; not a Prisma model |
| `reviews` | id, product_id, author_name, rating (1–5), title, body, created_at |
| `carts` | id, user_id (**unique**), created_at, updated_at |
| `cart_items` | id, cart_id, product_id, qty (>0), price_at_add_cents, added_at; **unique(cart_id, product_id)** |
| `orders` | id, order_number (unique), user_id, status, source, placed_by, total_cents, currency, idempotency_key, cart_id?, address_snapshot_json, turn_id?, client_message_id?, created_at, cancellable_until?, cancelled_at?, cancelled_by? |
| `order_items` | id, order_id, product_id, product_name, sku, qty (>0), unit_price_cents |
| `chat_sessions` | id, user_id, kind (`rag`/`agent`), title?, created_at, updated_at |
| `messages` | id, session_id, seq, role, content, model_content?, metadata_json, status, client_message_id?, created_at; **unique(session_id, client_message_id)** where not null |
| `token_usage` | id, user_id?, session_id?, run_id?, kind, model, provider, input_tokens, output_tokens, estimated, latency_ms, created_at |
| `guardrail_events` | id, user_id, session_id, rule, action, score?, details_json, request_id, created_at |
| `agent_runs` | id, session_id, turn_id, client_message_id, agent, route, model, provider, prompt_version, tool_calls_json, duration_ms, status, error_code?, created_at |

Enum-like columns (`status`, `source`, `placed_by`, `kind`, `role`) are `String` validated by zod and guarded by SQLite triggers/checks. `*_json` columns are TEXT containing JSON, parsed with zod.

## Invariants

- `orders`: `unique(user_id, idempotency_key)`; `unique(user_id, turn_id)` (one order per chat turn; null `turn_id` allowed for page/seed orders); `total_cents >= 0`; status/source/placed_by allowed values; indexes on `(user_id, created_at)`, `status`, `order_number`.
- `cart_items`: `qty > 0`; `unique(cart_id, product_id)`; deleting the last item leaves an empty cart row.
- `carts`: one per user; created lazily on first add; `updated_at` touched on every mutation.
- `addresses`: one per user; required at registration; `PATCH /users/me/address` for corrections.
- `messages`: `seq` gives deterministic order; `model_content` is the redacted text sent to providers; `status` marks failed turns.
- `token_usage`: `estimated=true` when the provider did not return usage metadata.
- `agent_runs`: `prompt_version` and `route` make replay/eval regressions traceable.
- `guardrail_events.details_json` never contains raw PII or raw prompt text.
- Cancel restocks products in the same transaction and records `cancelled_at`/`cancelled_by`.
- `order_items` and `orders.address_snapshot_json` are snapshots; history stays correct if catalog/address changes.

## Prisma + SQLite rules

- `prisma migrate dev` locally, `prisma migrate deploy` in CI/prod. Never `db push`/`db pull` on shared DBs.
- Prisma cannot model FTS5, CHECK constraints, or triggers. Use `prisma migrate dev --create-only`, edit the SQL, then apply; test with `prisma migrate reset`.
- SQLite cannot add CHECK constraints after table creation. Prefer `BEFORE INSERT/UPDATE` triggers for `qty > 0`, `stock >= 0`, `total_cents >= 0`, `rating` 1–5, and enum-like values.
- **Transactions:** acquire the process-wide write mutex before `prisma.$transaction` (interactive, explicit `maxWait`/`timeout`). Prisma does not expose `BEGIN IMMEDIATE`; the mutex serializes order/checkout writes on the single instance. Also set `busy_timeout`.
- **Pragmas:** `journal_mode=WAL` and `busy_timeout=5000` on startup; configure a single SQLite connection (`connection_limit=1`) and verify `foreign_keys=ON`.
- **Unique conflicts:** handle `P2002` by fetching the existing row and returning an idempotent response; map `P2025` to not found and `P2028`/`P2034` to structured transaction errors.
- **FTS5:** escape/quote user tokens, bind with `Prisma.sql`, and fall back to `LIKE`/`contains` when FTS returns nothing. Do not rely on external-content rowid coupling to string primary keys.
- **Checkpointer:** separate `data/checkpoints.db`; thread id = `${userId}:${sessionId}`.

## Seed (`pnpm db:seed`)

- Wire `prisma db seed` in `apps/api/package.json`.
- Deterministic RNG (`seedrandom`) so demos and evals are reproducible; seed is idempotent and safe to rerun.
- ~100 products across ~6 categories, 3–10 reviews each with varied ratings/tone.
- 3 demo users (each with an address and documented password), historical orders in `placed`, `cancelled`, `shipped`, `delivered`; one user with a non-empty cart.
- Test fixtures: malicious review (prompt injection), benign-but-suspicious review, PII review, markdown/HTML injection link, out-of-stock product, product with no reviews, price-change product, very long description.
- Policy docs in `content/policies/` (shipping, returns/refunds, warranty, payment methods, privacy, FAQ, cancellation) with real numbers/tables so RAG answers are verifiable.
