# Tracker

> Live progress file. Update after every task. If this file disagrees with the code, the code wins — fix this file.
> Last updated: 2026-11-27

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | done and verified |
| 🟨 | in progress |
| ⬜ | not started |
| ⛔ | blocked |
| ➖ | not applicable |

## Now

- **Phase:** 7 — Guardrails, evals, polish ✅ (closed 2026-11-26; `pnpm run ci` green)
- **Next action:** P0 done and §8.8 conflict resolved (block kept). P1 E2E/CI gaps remain; no Phase 8 exists in PLAN v5.
- **Blockers:** none. Chroma is only needed for live `/help` or `pnpm eval:rag`; the verified index has 52 chunks.
- **Open decisions:** none blocking. Free-tier TPM/RPD still unmeasured (see blockers below).

## Done so far

- `PLAN.md` v5 is the approved specification; the context layer and decisions log exist.
- **Phase 1 (closed):** pnpm/TS/Biome monorepo, shared zod contracts, NestJS API (env validation, pino, Prisma, auth, gateway with fallback/breaker/record-replay), Next.js shell, Docker Compose for Chroma, green `pnpm run ci`; live gateway call + fallback and 768-dim embeddings proven.
- **Early catalog/cart slice (Phase 1 request):** 100 products with FTS5/triggers, 673 generated reviews, full product/cart REST + pages, live header badge.
- **Phase 2:** orders/chat/usage/audit schema, 8 historical orders + 5 security/PII fixture reviews, 7 policy documents, idempotent Chroma ingest, read-only orders REST, `/orders` pages, non-fatal `/health/chroma`.
- **Phase 3:** shared SSE/chat contracts, session replay/retry + per-session lock, PII/token-budget/scope guardrails, grounded RAG over Chroma (`/rag/chat`, `/help`), live RAG eval, source footers.
- **Phase 4:** LangGraph read-only agents (`router` → `search`/`review`/`history`), deterministic fallbacks and product references, server-generated footers, `agent_runs` audit, `/agent/chat` buffered SSE, shared `/assistant` chat UI.
- **Phase 5:** `cart` agent with three tools, deterministic cart resolver, shared `CartService` limits, per-turn cart footer, cart-aware `/assistant` copy.
- **Phase 6:** order write path (mutex, limits, idempotency, stock, checkout/cancel REST) plus the `order` agent (four tools, resolver, receipt footers), wired `/cart` checkout and `/orders` badges/Cancel. All gate scenarios covered by tests; CI green.

## Phase progress

| Phase | Status | Acceptance gate (short) | Evidence |
|---|---|---|---|
| 0 — Planning | ✅ | PLAN.md v5 approved | `PLAN.md` |
| 1 — Foundation | ✅ | Gateway call + fallback logged; missing env fails fast; CI green | 45+ tests; live groq→gemini fallback |
| 2 — Data and Catalog | ✅ | Seed + ingest populate DB/Chroma; FTS/filters work; reruns do not duplicate | 100 products / 678 reviews / 8 orders; 52 chunks; orders REST + pages; CI green |
| 3 — RAG Chat | ✅ | 10 policy questions correct with sources; out-of-scope redirect; hit-rate reported | 10/10 hit-rate@5; 100% fact pass; 2/2 scope; no-match distance 0.410; CI green |
| 4 — Read-only Agents | ✅ | Search/review/history via `/assistant`; `agent_runs` recorded; retry deduped | live search→review→orders footers; replay same `clientMessageId`; concurrent 409; CI green |
| 5 — Cart | ✅ | UI + chat cart ops; limits; persistence; cross-user 404 | chat add/view/update/remove with footer; qty 5 ok / 6 refused; 20-line cap; CI green |
| 6 — Order and Checkout | ✅ | Direct order + cart checkout + limits + cancel + injection tests | 283 API + 12 web tests; idempotent replay; concurrent checkout serialized; malicious review cannot order; CI green |
| 7 — Guardrails, Evals, Polish | ✅ | Eval targets met; malicious review cannot order; demo script; CI green | jailbreak 100% block / 0% FPR; PII 100% / 0% FPR; agents 15/15; smoke 10 pass / 0 fail; 336 API + 12 web tests |

## Phase 7 checklist

- [x] Deterministic-first jailbreak pre-filter (history/tool scan, fail modes) wired before RAG/agent model calls; opt-in `guardrail` classifier; guardrail events on block/degrade
- [x] Redundancy detection (normalized-token Jaccard + tool-loop cap) with explicit-repeat/receipt exemptions; short-circuit before footer/persist
- [x] PII identifier protection (SKU/order IDs) removes 10-digit false positives; output mask unchanged
- [x] Datasets + runners: `eval:guardrails` (jailbreak 52+49, PII 25, redundancy 10, orders 15, cart 14) and `eval:agents` (15 replay scenarios), JSON results for CI
- [x] `pnpm guardrails:inspect` read-only audit; README runbook; `docs/demo-script.md`; `pnpm demo:smoke` executable smoke; `compose.demo.yml`
- [x] Fixed latent Nest DI boot bug (type-only imports of injected `OrderWriteService`/`CheckoutService`); CI green (336 API + 12 web)

## Phase 6 (condensed)

- [x] Order write path (mutex, idempotency, limits, cancel/restock) + four-tool order agent; REST checkout/cancel wired; injection tests; 283 API tests at close.

## Phase 5 checklist (condensed)

- [x] Three-tool `cart` agent + deterministic resolver (ordinals/SKU/name/id, qty from the message, non-committal refusal); tool re-runs resolver and rejects mismatches.
- [x] Shared `CartService` limits (qty 1..5, 20 lines, stock, price-change warnings, cross-user 404); per-turn cart footer; `lastCartSummary` persists only after a cart tool.
- [x] Router `agent-router-v2` + cart prompt; cart-aware `/assistant`; CI green. Detail: `context/commerce.md`, `context/agents.md`.

## Phase 4 checklist (condensed)

- [x] Router (`router` → one specialist) with confidence gate + deterministic heuristic; bounded state and SQLite checkpointer; five routes with ≤4 tools each.
- [x] `/agent/chat` buffered SSE with replay/409/persist-before-stream; server footers; `agent_runs`, `token_usage`, `guardrail_events`.

## Phase 3 checklist (condensed)

- [x] zod SSE/chat contracts with robust client parser; `ChatSessionService` (409, replay, deterministic seq).
- [x] RAG pipeline (PII → budget → condense → scope → Chroma top-5 → distance gate → answer → sanitize → persist → stream); guardrail events; `/help` + `eval:rag`.

## Phase 2 checklist (condensed)

- [x] Hand-written migration with enum/invariant triggers, FTS5, indexes, unique constraints; idempotent seed (8 orders, 678 reviews) and Chroma ingest (52 chunks).
- [x] Read-only orders REST (cursor, filters, user scoping), `/orders` pages, non-fatal `/health/chroma`.

## Phase 1 checklist (condensed)

- [x] Monorepo, shared contracts, env validation, auth, model gateway with fallback/breaker/record-replay, Next.js shell, CI green.

## Session log

| Date | Phase | What changed | Files | Next |
|---|---|---|---|---|
| 2026-11-24 | 0 | Created the context layer, tracker, and README pointer | `AGENTS.md`, `context/*`, `docs/decisions.md` | Phase 1 |
| 2026-11-24 | 1 | CI skeleton, Prisma migration + seed, gateway specs, web login/register, live fallback | `apps/**`, `packages/shared/**` | Phase 2 |
| 2026-11-25 | 1 | Approved model IDs/embeddings, boot fixes, served-call logging | `models.config.ts`, `apps/api/src/**` | Phase 2 |
| 2026-11-25 | 2 | Orders/chat/usage/audit schema, triggers, fixtures, policy docs | `prisma/**`, `content/policies/**` | Ingest |
| 2026-11-25 | 2 | Idempotent Chroma ingest (7 sources / 52 chunks; rerun 0 embedded) | `apps/api/src/rag/**`, `apps/api/scripts/**` | Orders REST |
| 2026-11-25 | 2 | Orders REST + `/orders` pages; Chroma probe; CI green | `packages/shared/src/orders.ts`, `apps/api/src/orders/**`, `apps/web/**` | Phase 3 |
| 2026-11-25 | 3 | SSE/chat contracts, sessions, guardrails, RAG pipeline, `/rag/chat` + `/help` | `packages/shared/src/{chat,events}.ts`, `apps/api/src/{chat,guardrails,rag}/**` | Eval |
| 2026-11-25 | 3 | RAG eval runner + dataset; live smoke; Phase 3 closed | `evals/rag/**`, `apps/api/src/rag/eval*.ts` | Phase 4 |
| 2026-11-26 | 4 | LangGraph router + search/review/history, tools, footers, checkpointer, `agent_runs` | `apps/api/src/agent/**` | `/assistant` |
| 2026-11-26 | 4 | `/assistant` on shared `ChatPanel`; safe chat links; Phase 4 closed | `apps/web/src/{app/assistant,components/**}` | Phase 5 |
| 2026-11-26 | 5 | Cart agent, resolver, tools, footer, router/prompt bump | `apps/api/src/agent/**`, `apps/api/src/cart/**` | Cart tests |
| 2026-11-26 | 5 | Cart service tests; Phase 5 closed | `apps/api/src/cart/cart.service.spec.ts` | Phase 6 |
| 2026-11-26 | 6 | Order write path: limits, mutex, idempotency, checkout/cancel REST (committed as `bd28145`) | `apps/api/src/orders/**`, `apps/api/src/common/write-mutex.ts`, `packages/shared/src/{dto,orders}.ts` | Order agent |
| 2026-11-26 | 6 | Order agent (resolver, 4 tools, receipt footers, graph node), web checkout/cancel/badges; CI green; Phase 6 closed | `apps/api/src/agent/agent.order.*`, `agent.{tools,graph,footer,policy,prompts,types}.ts`, `apps/web/src/{lib/api.ts,components/**}` | Phase 7 |
| 2026-11-26 | 7 | Jailbreak/redundancy guardrails, offline eval datasets + runners, guardrail inspect, demo script/smoke, README/compose, DI boot fix; Phase 7 closed | `apps/api/src/{guardrails,evals,cart}/**`, `apps/api/scripts/**`, `evals/**`, `docs/demo-script.md`, `scripts/demo/**`, `compose.demo.yml` | nightly live evals |
| 2026-11-27 | 7+ | P0 follow-up: rate-limit guard + helmet, gateway retry/quota/usage/record/JSON capability/run deadline, guardrail ordering/fail-mode/tool scan/DB busy retry; §8.8 block kept; 354 API tests | `apps/api/src/{common,guardrails,model-gateway,orders,agent,rag}/**`, `PLAN.md`, `context/*`, `docs/decisions.md` | P1 E2E |
| 2026-11-27 | 7+ | Fixed stale-cookie 500 on `/help` after `demo:reset`: stable seed user IDs + `JwtAuthGuard` existence check (401 instead of FK 500); 359 API tests, CI green | `apps/api/prisma/seed.ts`, `apps/api/src/common/guards/jwt-auth.guard.{ts,spec.ts}`, `docs/decisions.md` | P1 E2E |
| 2026-11-27 | 7+ | Made `/help` usable without sign-in: signed guest cookie → isolated guest user, RAG/session routes anonymous-capable, guest rate-limits keyed by IP; PLAN §21 amended | `apps/api/src/common/guards/anonymous-identity.guard.{ts,spec.ts}`, `apps/api/src/{app.module.ts,rag/rag.controller.ts,chat/sessions.controller.ts}`, `PLAN.md`, `docs/*` | P1 E2E |
| 2026-11-27 | 7+ | Removed the visible `Sources:` section from `/help`: no server footer, no client metadata rendering, answer-only prompt; sources kept in stored metadata for eval/audit | `apps/api/src/rag/{rag.service.ts,prompt.ts,*.spec.ts}`, `apps/web/src/components/{chat-message.tsx,help-chat.tsx}`, `PLAN.md`, `context/agents.md`, `docs/*` | P1 E2E |

## Blockers and open questions

- **Free-tier quotas:** model IDs/capabilities verified 2026-11-25; TPM/RPD quotas still unmeasured.
- **Embedding model:** `gemini-embedding-001` @768 is pinned; changing it requires `rag:ingest:reset`.
- **Prisma drift:** `prisma migrate dev` sees the FTS5 shadow tables as drift; use hand-written migrations + `prisma migrate deploy`.
- **Chroma in this environment:** Docker was unavailable; Phase 3 used a local `chromadb==1.5.9` server on `127.0.0.1:8000`. The app/compose contract is unchanged.
- **Phase 7:** offline targets met; the opt-in live classifier eval has not been run against provider keys.

## Update protocol

1. Mark the task/phase status and add evidence.
2. Add a session-log row (date, phase, what changed, files, next).
3. Append decisions/assumptions to `docs/decisions.md`.
4. Update the affected context topic file only if behavior or a contract changed.
5. Keep this file ≤120 lines; move detail to topic files or the decision log.
