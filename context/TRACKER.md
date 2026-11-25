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

- **Phase:** 1 — Foundation ✅ (acceptance gate met; catalog + cart routes delivered early on request)
- **Next action:** Start Phase 2 — orders/chat/usage tables, full seed fixtures (historical orders, injection/PII reviews), policy docs + `rag:ingest`, then orders REST + `/orders` pages.
- **Blockers:** the Docker daemon is up, but the Chroma container is **not** running (`docker compose ps` is empty and `127.0.0.1:8000` refuses connections). Run `pnpm docker:up` before `rag:ingest` / the Phase 2 gate.
- **Open decisions:** embedding model is `gemini-embedding-001` @768 (revisit `gemini-embedding-2` before ingest only if desired); free-tier quotas still unmeasured.

## Done so far

- `PLAN.md` v5 is the approved specification.
- Context layer exists: `AGENTS.md`, `context/*`, `docs/decisions.md`.
- Phase 1 scaffold: pnpm workspace, strict TS, Biome, `packages/shared`, NestJS API with env validation, pino, Prisma service, auth (register/login/logout/me), gateway (chains/fallback/breaker/record-replay), Docker Compose for Chroma.
- **CI pipeline green**: `pnpm run ci` (lint → typecheck → unit tests → build) passes locally; 45 unit tests (11 shared DTO/contract, 2 web form, 32 API: 9 model gateway, 7 migration/schema, 3 exception filter, cart/search helpers).
- **Initial Prisma migration**: `20261124170850_init_user_address` (`users`, `addresses`, unique indexes, cascade FK) + idempotent Phase 1 seed (3 demo users with addresses); `pnpm db:migrate` and `pnpm db:reset` verified on fresh SQLite files.
- **Web app**: Next.js App Router shell (`/`, `/login`, `/register`), Rubik + Nunito Sans, minimal neutral/violet tokens, zod-backed forms with error summary + address on registration, `/api/*` rewrite to NestJS.
- **API runtime verified**: `node dist/main.js` boots (root `.env` loaded before zod), auth flows work through the Next rewrite, missing env fails fast, `/gateway/test` without keys returns `PROVIDER_UNAVAILABLE`.
- **Phase 1 acceptance (live)**: `groq/openai/gpt-oss-20b` served the test call in 1.3s and logged `chain/provider/model/attempt/elapsedMs`; with `PROVIDER_DISABLE=groq` the same call was served by `gemini/gemini-3.5-flash-lite`; explicit `gemini-3.6-flash` also works; a live `gemini-embedding-001` call returned 768 dims.
- **Phase 1 completion (catalog + cart)**: added `products`, `reviews`, `carts`, `cart_items` + FTS5/triggers migration; deterministic seed (100 products, 673 reviews, demo cart for alice); `GET /products`, `GET /products/:id`, and the full cart REST surface; `/products`, `/products/:id`, `/cart` pages with search/filters, add-to-cart, qty stepper, warnings, and a live header badge. Runtime-verified through the Next proxy.
- Design system synced to the implemented direction in `design-system/shopping-agent/MASTER.md`.

## Phase progress

| Phase | Status | Acceptance gate (short) | Evidence |
|---|---|---|---|
| 0 — Planning | ✅ | PLAN.md v5 approved | `PLAN.md` |
| 1 — Foundation | ✅ | Gateway test endpoint + fallback + logged call + missing env fails fast + CI green | CI green; 45 tests; live call groq→gemini fallback proven; auth verified end-to-end |
| 2 — Data and Catalog | ⬜ | Seed + ingest populate DB/Chroma; FTS and filters work; reruns do not duplicate | Catalog/cart slice done early (100 products, FTS5, cart REST + pages); orders/ingest remain |
| 3 — RAG Chat | ⬜ | 10 policy questions correct with sources; out-of-scope redirect; no-match answer; hit-rate reported | — |
| 4 — Read-only Agents | ⬜ | Search/review/history work via `/assistant`; `agent_runs` recorded; retry deduped; concurrent session 409 | — |
| 5 — Cart | ⬜ | UI + chat cart ops; limits; persistence; cross-user 404; footer | — |
| 6 — Order and Checkout | ⬜ | Direct order + cart checkout + all limits + cancel + injection tests | — |
| 7 — Guardrails, Evals, Polish | ⬜ | Eval targets met; malicious review cannot order; demo script; CI green | — |

## Phase 1 checklist

- [x] pnpm monorepo, TypeScript strict, lint/format (Biome), `packages/shared` wiring, `.nvmrc`, `packageManager`, `engines`
- [x] NestJS config module + zod env validation (fail-fast verified at runtime)
- [x] pino logging with redaction
- [x] Prisma + SQLite (WAL, `busy_timeout`, FK), Prisma Migrate (`init_user_address`), `PrismaService` singleton
- [x] Auth: register/login/logout/me, JWT cookie, guard (runtime verified through the web proxy)
- [x] Next.js login/register pages (registration includes address)
- [x] Docker Compose for Chroma (pinned image, volume, healthcheck, localhost bind) — `docker compose config` valid; daemon still stopped
- [x] Model gateway: role→chain config, capability matrix, fallback, timeouts, provider quotas, record/replay (+ served-call log line)
- [x] CI skeleton: lint, typecheck, unit, build (green via `pnpm run ci`)
- [x] `docs/decisions.md` (seeded 2026-11-24, updated 2026-11-25)
- [x] Acceptance: live gateway call + disabled-provider fallback proof; call logged; missing env fails fast; CI green

### User-requested Phase 1 completion: catalog + cart

- [x] Prisma models + migration for `products`, `reviews`, `carts`, `cart_items`, with FTS5, sync triggers, stock/price/rating/qty invariants
- [x] Deterministic, idempotent seed: 100 products across 6 categories, 673 reviews, one demo cart for `alice@example.com`
- [x] `GET /products` (FTS5 search + category/price filters + limit/offset) and `GET /products/:id` (with reviews)
- [x] Cart REST: `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:productId`, `DELETE /cart/items/:productId`, `DELETE /cart`; qty/line/stock limits; price-change and over-limit warnings
- [x] Web: `/products` (search/filter/load more), `/products/:id` (detail + reviews), `/cart` (qty stepper, remove, clear, subtotal, warnings, checkout placeholder), header cart badge
- [x] Runtime verification through the Next `/api/*` proxy: 401 without auth, login → search → detail → cart add/patch/remove/clear all pass

> Evidence: `/gateway/test` served by `groq/openai/gpt-oss-20b`; with `PROVIDER_DISABLE=groq` served by `gemini/gemini-3.5-flash-lite`; explicit `gemini-3.6-flash` works; `gemini-embedding-001` returned 768 dims. Chroma healthcheck still unverified (Docker daemon stopped).

## Session log

| Date | Phase | What changed | Files | Next |
|---|---|---|---|---|
| 2026-11-24 | 0 | Created the context layer, tracker, and README pointer | `AGENTS.md`, `context/*`, `docs/decisions.md`, `README.md` | Start Phase 1: scaffold workspace |
| 2026-11-24 | 1 | Completed the CI skeleton: fixed Biome 2.6.9 config, strict typecheck (shared build ordering, Nest/Prisma/LangChain types), shared DTO empty-string normalization; added 9 model-gateway unit tests (fallback, breaker, replay, capabilities) and made `NO_CASSETTE` fail fast | `biome.json`, `package.json`, `packages/shared/src/dto.ts`, `apps/api/src/**`, `apps/api/src/model-gateway/*.spec.ts` | Add Prisma migrations for User/Address |
| 2026-11-24 | 1 | Added the initial Prisma migration (`users`, `addresses`, unique indexes, cascade FK) plus an idempotent Phase 1 seed and a migration smoke test; verified `pnpm db:migrate` (deploy) and `pnpm db:reset` on fresh SQLite files | `apps/api/prisma/migrations/**`, `apps/api/prisma/seed.ts`, `apps/api/src/db/migrations.spec.ts`, `apps/api/package.json`, `apps/api/tsconfig*.json`, `README.md` | Scaffold `apps/web` login/register pages |
| 2026-11-25 | 1 | Made the API boot for real: dotenv before zod validation, value imports for Nest DI, `rootDir: src` build, public 5xx codes in the exception filter (+3 specs), served-call gateway log; Biome parses Tailwind CSS | `apps/api/src/main.ts`, `apps/api/src/**`, `apps/api/tsconfig.build.json`, `biome.json` | Finish the web scaffold and verify auth |
| 2026-11-25 | 1 | Committed the Next.js web app (home, login, register with address), synced the design system, verified auth end-to-end through the Next `/api/*` proxy; `pnpm run ci` green | `apps/web/**`, `design-system/shopping-agent/MASTER.md`, `.env.example`, `pnpm-lock.yaml` | Add keys; live gateway + fallback acceptance |
| 2026-11-25 | 1 | **Phase 1 closed**: verified model IDs against provider docs + live calls; groq primary served the gateway call, gemini served it with groq disabled; call logged with provider/model; embedding key returned 768 dims | `apps/api/src/model-gateway/models.config.ts`, `docs/decisions.md`, `context/TRACKER.md` | Phase 2: schema + FTS5 + seed |

## Blockers and open questions

- **Docker daemon:** stopped locally. `docker compose config` is valid, but the Chroma healthcheck has not run; start Docker before Phase 2 ingest.
- **Free-tier quotas:** model IDs/capabilities verified 2026-11-25, but TPM/RPD quotas are unmeasured; keep conservative budgets until Phase 2 usage data exists.
- **Embedding model:** `gemini-embedding-001` @768 is verified live. Switching to `gemini-embedding-2` would need a full re-index; decide before the first ingest.
- **Budgets/limits:** proposed values are in `PLAN.md` §10/§20; re-measure after Phase 1.
- **Cancel window:** proposed 30 minutes; confirm during Phase 6.

## Update protocol

1. Mark the task/phase status and add evidence.
2. Add a session-log row (date, phase, what changed, files, next).
3. Append decisions/assumptions to `docs/decisions.md`.
4. Update the affected context topic file only if behavior or a contract changed.
5. Keep this file ≤120 lines; move detail to the topic files or decision log.
