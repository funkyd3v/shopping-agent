# Tracker

> Live progress file. Update after every task. If this file disagrees with the code, the code wins — fix this file.
> Last updated: 2026-11-26

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | done and verified |
| 🟨 | in progress |
| ⬜ | not started |
| ⛔ | blocked |
| ➖ | not applicable |

## Now

- **Phase:** 5 — Cart ✅ (closed 2026-11-26; `pnpm run ci` green)
- **Next action:** start Phase 6 — order agent and checkout (PLAN §9): `OrderService`/`CheckoutService`, resolver, limits, write mutex, idempotency.
- **Blockers:** none. Start Chroma (`pnpm docker:up`) before local `/help` use or `pnpm eval:rag`; the verified index has 52 chunks.
- **Open decisions:** orders REST stays read-only until Phase 6 (cancel moves there); `/assistant` still routes order asks to page copy until Phase 6.

## Done so far

- `PLAN.md` v5 is the approved specification; the context layer and decisions log exist.
- **Phase 1 (closed):** pnpm/TS/Biome monorepo, shared zod contracts, NestJS API (env validation, pino, Prisma, auth, gateway with fallback/breaker/record-replay), Next.js shell, Docker Compose for Chroma, green `pnpm run ci`; live gateway call + fallback and 768-dim embeddings proven.
- **Early catalog/cart slice (Phase 1 request):** 100 products with FTS5/triggers, 673 generated reviews, full product/cart REST + pages, live header badge.
- **Phase 2:** orders/chat/usage/audit schema, 8 historical orders + 5 security/PII fixture reviews, 7 policy documents, idempotent Chroma ingest (`rag:ingest`), read-only orders REST, `/orders` list/detail pages with status filters and cursor pagination, non-fatal `/health/chroma` probe.
- **Phase 3:** shared SSE/chat contracts, session replay/retry + per-session lock, PII/token-budget/scope guardrails, grounded RAG over Chroma (`/rag/chat`, `/help`), live RAG eval with hit-rate/fact checks, and source footers.
- **Phase 4:** LangGraph read-only agents (`router` → `search`/`review`/`history`), deterministic fallbacks and product references, server-generated product/order footers, `agent_runs` audit, `/agent/chat` buffered SSE, and the `/assistant` page on a shared chat UI.
- **Phase 5:** `cart` agent with exactly `view_cart`/`add_to_cart`/`update_cart_item`, deterministic cart resolver (ordinals, SKU/name/id, quantity from the user message, non-committal refusal), shared `CartService` limits, per-turn cart footer, and cart-aware `/assistant` copy.

## Phase progress

| Phase | Status | Acceptance gate (short) | Evidence |
|---|---|---|---|
| 0 — Planning | ✅ | PLAN.md v5 approved | `PLAN.md` |
| 1 — Foundation | ✅ | Gateway call + fallback logged; missing env fails fast; CI green | 45+ tests; live groq→gemini fallback |
| 2 — Data and Catalog | ✅ | Seed + ingest populate DB/Chroma; FTS/filters work; reruns do not duplicate | 100 products / 678 reviews / 8 orders; 52 chunks (rerun: 0 embedded); orders REST + pages verified via proxy; `/health/chroma` ok (52 chunks) and 200/unavailable with Chroma paused; CI green |
| 3 — RAG Chat | ✅ | 10 policy questions correct with sources; out-of-scope redirect; hit-rate reported | 10/10 hit-rate@5; 100% fact pass; scope 2/2; no-match distance 0.410 > 0.38; live `/rag/chat` SSE smoke; 140 API tests; CI green |
| 4 — Read-only Agents | ✅ | Search/review/history via `/assistant`; `agent_runs` recorded; retry deduped | live search→review→orders (footers with `/products/:id`, `/orders/:id`); replay same `clientMessageId` = same turn; concurrent turn 409; `agent_runs` rows show route/model/tool calls; 181 API + 12 web tests; CI green |
| 5 — Cart | ✅ | UI + chat cart ops; limits; persistence; cross-user 404 | chat add/view/update/remove with cart footer; qty 5 allowed / 6 refused; 20-line cap; out-of-stock refused; cross-user 404; price-change + empty state; 227 API + 12 web tests; CI green |
| 6 — Order and Checkout | ⬜ | Direct order + cart checkout + all limits + cancel + injection tests | — |
| 7 — Guardrails, Evals, Polish | ⬜ | Eval targets met; malicious review cannot order; demo script; CI green | — |

## Phase 5 checklist

- [x] Cart agent route (`cart`) with exactly three tools: `view_cart`, `add_to_cart`, `update_cart_item`; identity injected from request context
- [x] Deterministic `agent.cart.ts` resolver: commit verbs, non-committal refusal, ordinal/name/SKU/id references, quantity from the user message only, qty 0 removes; the tool re-runs it and rejects mismatches (`NEEDS_CLARIFICATION`/`INTENT_UNRESOLVED`)
- [x] Chat mutations reuse `CartService`: qty 1..5, 20-line cap, stock, price-change warnings, empty cart; cross-user reads/writes stay 404
- [x] Server-generated cart footer (lines, qty, unit price, line total, subtotal, `/cart`); `cartFooter` is per-turn, `lastCartSummary` persists only after a cart tool
- [x] Router `agent-router-v2` + cart prompt `agent-cart-v1`; `/assistant` copy/examples mention cart; no agent-specific UI
- [x] Tests: resolver/quantity helpers, graph add/fallback/non-committal, tool guards, cart service math/limits/stock/404/empty/price-change; `pnpm run ci` green (227 API + 12 web)

## Phase 4 checklist

- [x] LangGraph router (`agent-router-v1`) with confidence gate + deterministic heuristic fallback; one specialist per turn (`search`/`review`/`history`)
- [x] Read-only tools via domain services (`ProductSearchService`, `OrderService`): `search_products`, `get_product`, `get_reviews`, `list_orders`, `get_order`; identity injected from context; zod-validated args; untrusted envelopes, flag scan, output caps
- [x] Bounded state + SQLite checkpointer (`CHECKPOINT_DATABASE_PATH`, thread `${userId}:${sessionId}`); deterministic product references from `lastListedProducts`; per-run caps
- [x] `/agent/chat` buffered SSE: input PII → budget → graph → output sanitize/PII mask → server footers → persist → stream; replay and per-session 409
- [x] `agent_runs` per turn + `token_usage` per model call + `guardrail_events`; `/assistant` on shared `ChatPanel`; live smoke + CI green

## Phase 3 checklist

- [x] Shared SSE + chat zod contracts (`packages/shared/events.ts`, `chat.ts`); client parses/validates every frame (partial frames, CRLF, multiple `data:` lines, malformed frames)
- [x] `ChatSessionService`: per-session lock (409), `clientMessageId` replay/retry, deterministic `seq`, assistant persisted before streaming; `GET /sessions?kind=` and `GET /sessions/:id/messages`
- [x] RAG chain: input PII redaction → token budget → follow-up condense → scope guard → fixed Gemini embedding → Chroma top-5 → distance gate → grounded answer → output sanitation → deduplicated `Sources:` → persist → stream
- [x] Guardrails: PII input/output (email/phone/Luhn card), request/session/daily token budgets, scope heuristic + classifier, `guardrail_events` row + log per action; Chroma/embedding/provider failures degrade to friendly copy
- [x] `/help` page + `pnpm eval:rag` (live): 10 in-scope questions, 2 out-of-scope, 1 no-match; `--retrieval-only`/`--json`; CI green

## Phase 2 checklist

- [x] Prisma models + hand-written migration `20261125170000_add_orders_chat_usage` with enum/invariant triggers, indexes, unique constraints
- [x] Idempotent seed: 8 historical orders across all statuses with address/item snapshots; 5 injection/PII/HTML fixture reviews (678 reviews total)
- [x] 7 policy documents in `content/policies/`; `rag:ingest`/`rag:ingest:reset` with markdown chunker, explicit Gemini embeddings @768, metadata pinning, stale-chunk pruning; reruns make zero embedding calls
- [x] `GET /orders` (status filter, opaque keyset cursor, `itemCount`) and `GET /orders/:id`; every query scoped by user; cross-user reads return 404
- [x] Web `/orders` list/detail pages + nav; non-fatal `GET /health/chroma` probe; CI green

## Phase 1 checklist (condensed)

- [x] Monorepo, strict TS, Biome, shared contracts, Docker Compose for Chroma
- [x] NestJS API: env validation, pino redaction, Prisma/WAL, auth cookie, guard
- [x] Model gateway: chains/fallback/breaker/record-replay with served-call logs
- [x] Next.js shell, login/register, `/api/*` rewrite; CI green; live acceptance proven

## Session log

| Date | Phase | What changed | Files | Next |
|---|---|---|---|---|
| 2026-11-24 | 0 | Created the context layer, tracker, and README pointer | `AGENTS.md`, `context/*`, `docs/decisions.md`, `README.md` | Start Phase 1 |
| 2026-11-24 | 1 | CI skeleton, Prisma init migration + seed, gateway specs, web login/register, live fallback acceptance | `apps/**`, `packages/shared/**`, `biome.json` | Phase 2 |
| 2026-11-25 | 1 | Approved model IDs/embeddings, design system sync, API boot fixes, served-call logging | `models.config.ts`, `design-system/**`, `apps/api/src/**` | Phase 2 |
| 2026-11-25 | 2 | Orders/chat/usage/audit schema + triggers; historical orders and fixture reviews seeded; policy docs | `prisma/**`, `content/policies/**` | Ingest |
| 2026-11-25 | 2 | Idempotent Chroma policy ingest verified live (7 sources / 52 chunks; rerun 0 embedded) | `apps/api/src/rag/**`, `apps/api/scripts/**` | Orders REST |
| 2026-11-25 | 2 | Read-only orders REST (cursor, filters, user scoping) and `/orders` pages + nav; Chroma health probe; CI green; Phase 2 closed | `packages/shared/src/orders.ts`, `apps/api/src/{orders,health}/**`, `apps/web/**` | Phase 3 |
| 2026-11-25 | 3 | SSE/chat contracts, session lifecycle, guardrails (PII/budget/scope), RAG pipeline + Chroma retriever, `/rag/chat` and `/help` | `packages/shared/src/{chat,events}.ts`, `apps/api/src/{chat,guardrails,rag}/**`, `apps/web/src/{app/help,components/help-chat.tsx,lib/sse.ts}` | Eval |
| 2026-11-25 | 3 | RAG eval runner + 10-question dataset; `maxDistance=0.38`; live smoke; CI green; Phase 3 closed | `evals/rag/policy-questions.json`, `apps/api/scripts/rag-eval.ts`, `apps/api/src/rag/eval*.ts`, `context/*`, `docs/decisions.md` | Phase 4 |
| 2026-11-26 | 4 | LangGraph read-only agents (router + search/review/history), tools, deterministic fallbacks/refs, footers, checkpointer, `agent_runs`, `/agent/chat` SSE | `apps/api/src/agent/**`, `apps/api/src/{app.module.ts,config/env.ts}`, `packages/shared/src/chat.ts` | `/assistant` |
| 2026-11-26 | 4 | `/assistant` page + shared `ChatPanel` (also `/help`), nav link, safe chat links; live smoke; CI green; Phase 4 closed | `apps/web/src/{app/assistant,components/chat-panel.tsx,components/assistant-chat.tsx,lib/chat-links.ts}`, `context/*`, `docs/decisions.md` | Phase 5 |
| 2026-11-26 | 5 | Cart agent (view/add/update), deterministic resolver + quantity parsing, cart tools/footer, router/prompt bump, `/assistant` copy | `apps/api/src/agent/**`, `apps/api/src/cart/**`, `apps/web/src/{app/assistant,components/assistant-chat.tsx}` | Cart tests |
| 2026-11-26 | 5 | Cart service tests (math, limits, stock, cross-user 404, price change, empty); CI green; Phase 5 closed | `apps/api/src/cart/cart.service.spec.ts`, `context/*`, `docs/decisions.md` | Phase 6 |

## Blockers and open questions

- **Free-tier quotas:** model IDs/capabilities verified 2026-11-25; TPM/RPD quotas still unmeasured.
- **Embedding model:** `gemini-embedding-001` @768 is pinned in `models.config.ts`; changing it requires `rag:ingest:reset`.
- **Cancel window:** 30 minutes is proposed; endpoint and UI land in Phase 6.
- **Prisma drift:** `prisma migrate dev` sees the FTS5 shadow tables as drift; use hand-written migrations + `prisma migrate deploy`.
- **Chroma in this environment:** Docker was unavailable for Phase 3 verification; a local `chromadb==1.5.9` server on `127.0.0.1:8000` was used. The app/config/compose contract is unchanged.

## Update protocol

1. Mark the task/phase status and add evidence.
2. Add a session-log row (date, phase, what changed, files, next).
3. Append decisions/assumptions to `docs/decisions.md`.
4. Update the affected context topic file only if behavior or a contract changed.
5. Keep this file ≤120 lines; move detail to topic files or the decision log.
