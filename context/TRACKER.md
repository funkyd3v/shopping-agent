# Tracker

> Live progress file. Update after every task. If this file disagrees with the code, the code wins — fix this file.
> Last updated: 2026-11-25

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | done and verified |
| 🟨 | in progress |
| ⬜ | not started |
| ⛔ | blocked |
| ➖ | not applicable |

## Now

- **Phase:** 2 — Data and Catalog ✅ (closed 2026-11-25; `pnpm run ci` green)
- **Next action:** start Phase 3 — RAG chat (PLAN §7): retrieval + `/rag/chat` SSE + `/help`.
- **Blockers:** none. Chroma runs on `127.0.0.1:8000`; 52 policy chunks are ingested.
- **Open decisions:** orders REST is read-only until Phase 6 (cancel moves there); `/orders` shows no AI badge or cancel button yet.

## Done so far

- `PLAN.md` v5 is the approved specification; the context layer and decisions log exist.
- **Phase 1 (closed):** pnpm/TS/Biome monorepo, shared zod contracts, NestJS API (env validation, pino, Prisma, auth, gateway with fallback/breaker/record-replay), Next.js shell, Docker Compose for Chroma, green `pnpm run ci`; live gateway call + fallback and 768-dim embeddings proven.
- **Early catalog/cart slice (Phase 1 request):** 100 products with FTS5/triggers, 673 generated reviews, full product/cart REST + pages, live header badge.
- **Phase 2:** orders/chat/usage/audit schema, 8 historical orders + 5 security/PII fixture reviews, 7 policy documents, idempotent Chroma ingest (`rag:ingest`), read-only orders REST, `/orders` list/detail pages with status filters and cursor pagination, non-fatal `/health/chroma` probe.

## Phase progress

| Phase | Status | Acceptance gate (short) | Evidence |
|---|---|---|---|
| 0 — Planning | ✅ | PLAN.md v5 approved | `PLAN.md` |
| 1 — Foundation | ✅ | Gateway call + fallback logged; missing env fails fast; CI green | 45+ tests; live groq→gemini fallback |
| 2 — Data and Catalog | ✅ | Seed + ingest populate DB/Chroma; FTS/filters work; reruns do not duplicate | 100 products / 678 reviews / 8 orders; 52 chunks (rerun: 0 embedded); orders REST + pages verified via proxy; `/health/chroma` ok (52 chunks) and 200/unavailable with Chroma paused; CI green |
| 3 — RAG Chat | ⬜ | 10 policy questions correct with sources; out-of-scope redirect; hit-rate reported | — |
| 4 — Read-only Agents | ⬜ | Search/review/history via `/assistant`; `agent_runs` recorded; retry deduped | — |
| 5 — Cart | ⬜ | UI + chat cart ops; limits; persistence; cross-user 404 | — |
| 6 — Order and Checkout | ⬜ | Direct order + cart checkout + all limits + cancel + injection tests | — |
| 7 — Guardrails, Evals, Polish | ⬜ | Eval targets met; malicious review cannot order; demo script; CI green | — |

## Phase 2 checklist

- [x] Prisma models + hand-written migration `20261125170000_add_orders_chat_usage` with enum/invariant triggers, indexes, unique constraints
- [x] Idempotent seed: 8 historical orders across all statuses with address/item snapshots; 5 injection/PII/HTML fixture reviews (678 reviews total)
- [x] 7 policy documents in `content/policies/` (shipping, returns, warranty, payment methods, privacy, FAQ, cancellation)
- [x] `rag:ingest` / `rag:ingest:reset`: markdown-aware chunker, explicit Gemini embeddings @768, Chroma collection metadata pinning, stale-chunk pruning; reruns make zero embedding calls
- [x] `GET /orders` (status filter, opaque keyset cursor, `itemCount`) and `GET /orders/:id`; every query scoped by user; cross-user reads return 404
- [x] Web `/orders` (filter tabs, load more, empty/auth/error states) and `/orders/:id` (items, totals, address snapshot, cancellation dates); header "Orders" link
- [x] Chroma health check (non-fatal) surfaced next to DB health: public `GET /health/chroma` (read-only collection/metadata/count probe, 2 s timeout, always 200; `GET /health` stays DB-only)
- [x] `pnpm run ci` green after Phase 2 (lint, typecheck, 85 tests across workspaces, build); context docs + decisions updated

## Phase 1 checklist (condensed)

- [x] Monorepo, strict TS, Biome, shared contracts, Docker Compose for Chroma
- [x] NestJS API: env validation, pino redaction, Prisma/WAL, auth cookie, guard
- [x] Model gateway: chains/fallback/breaker/record-replay with served-call logs
- [x] Next.js shell, login/register, `/api/*` rewrite; CI green; live acceptance proven
- [x] Catalog + cart delivered early: FTS5 search/filters, detail/reviews, cart REST/pages

## Session log

| Date | Phase | What changed | Files | Next |
|---|---|---|---|---|
| 2026-11-24 | 0 | Created the context layer, tracker, and README pointer | `AGENTS.md`, `context/*`, `docs/decisions.md`, `README.md` | Start Phase 1 |
| 2026-11-24 | 1 | CI skeleton, Prisma init migration + seed, gateway specs, web login/register, live fallback acceptance | `apps/**`, `packages/shared/**`, `biome.json` | Phase 2 |
| 2026-11-25 | 1 | Approved model IDs/embeddings, design system sync, API boot fixes, served-call logging | `models.config.ts`, `design-system/**`, `apps/api/src/**` | Phase 2 |
| 2026-11-25 | 2 | Orders/chat/usage/audit schema + triggers; historical orders and fixture reviews seeded; policy docs | `prisma/**`, `content/policies/**` | Ingest |
| 2026-11-25 | 2 | Idempotent Chroma policy ingest verified live (7 sources / 52 chunks; rerun 0 embedded) | `apps/api/src/rag/**`, `apps/api/scripts/**` | Orders REST |
| 2026-11-25 | 2 | Read-only orders REST (cursor, filters, user scoping) and `/orders` pages + nav | `packages/shared/src/orders.ts`, `apps/api/src/orders/**`, `apps/web/**` | Health + CI |
| 2026-11-25 | 2 | Non-fatal `/health/chroma` probe (read-only, 2 s timeout, metadata assert), docs sync, CI green; Phase 2 closed | `apps/api/src/health/**`, `apps/api/src/rag/chroma.store.ts`, `apps/api/src/health.controller.ts`, `context/*`, `docs/decisions.md` | Phase 3 |

## Blockers and open questions

- **Free-tier quotas:** model IDs/capabilities verified 2026-11-25; TPM/RPD quotas still unmeasured.
- **Embedding model:** `gemini-embedding-001` @768 is pinned in `models.config.ts`; changing it requires `rag:ingest:reset`.
- **Cancel window:** 30 minutes is proposed; endpoint and UI land in Phase 6.
- **Prisma drift:** `prisma migrate dev` sees the FTS5 shadow tables as drift; use hand-written migrations + `prisma migrate deploy`.

## Update protocol

1. Mark the task/phase status and add evidence.
2. Add a session-log row (date, phase, what changed, files, next).
3. Append decisions/assumptions to `docs/decisions.md`.
4. Update the affected context topic file only if behavior or a contract changed.
5. Keep this file ≤120 lines; move detail to topic files or the decision log.
