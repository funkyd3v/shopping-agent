# Tracker

> Live progress file. Update after every task. If this file disagrees with the code, the code wins — fix this file.
> Last updated: 2026-11-24

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | done and verified |
| 🟨 | in progress |
| ⬜ | not started |
| ⛔ | blocked |
| ➖ | not applicable |

## Now

- **Phase:** 1 — Foundation
- **Status:** 🟨 in progress (code complete; live gateway acceptance pending keys)
- **Next action:** Add `GROQ_API_KEY` + `GOOGLE_API_KEY` to `.env`, then run the live `/gateway/test` call, disable one provider to prove fallback, confirm the served provider/model log line, and update `models.config.ts` `verified_at`. Then start Phase 2.
- **Blockers:** `GROQ_API_KEY`/`GOOGLE_API_KEY` are empty in `.env`; the local Docker daemon is not running (Compose config validates, Chroma healthcheck unverified).
- **Open decisions:** model IDs/free-tier limits need the live verification pass; embedding provider decided (Gemini).

## Done so far

- `PLAN.md` v5 is the approved specification.
- Context layer exists: `AGENTS.md`, `context/*`, `docs/decisions.md`.
- Phase 1 scaffold: pnpm workspace, strict TS, Biome, `packages/shared`, NestJS API with env validation, pino, Prisma service, auth (register/login/logout/me), gateway (chains/fallback/breaker/record-replay), Docker Compose for Chroma.
- **CI pipeline green**: `pnpm run ci` (lint → typecheck → unit tests → build) passes locally; 19 unit tests (6 shared DTO, 9 model gateway, 4 migration smoke; +3 exception-filter after the runtime fix).
- **Initial Prisma migration**: `20261124170850_init_user_address` (`users`, `addresses`, unique indexes, cascade FK) + idempotent Phase 1 seed (3 demo users with addresses); `pnpm db:migrate` and `pnpm db:reset` verified on fresh SQLite files.
- **Web app**: Next.js App Router shell (`/`, `/login`, `/register`), Rubik + Nunito Sans, minimal neutral/violet tokens, zod-backed forms with error summary + address on registration, `/api/*` rewrite to NestJS.
- **API runtime verified**: `node dist/main.js` boots (root `.env` loaded before zod), auth flows work through the Next rewrite (register → me → logout → 401 → login → me), missing env fails fast, `/gateway/test` without keys returns `PROVIDER_UNAVAILABLE`.
- Design system synced to the implemented direction in `design-system/shopping-agent/MASTER.md`.

## Phase progress

| Phase | Status | Acceptance gate (short) | Evidence |
|---|---|---|---|
| 0 — Planning | ✅ | PLAN.md v5 approved | `PLAN.md` |
| 1 — Foundation | 🟨 | Gateway test endpoint + fallback + logged call + missing env fails fast + CI green | CI green; 19 tests; auth runtime verified; live gateway/fallback awaiting keys |
| 2 — Data and Catalog | ⬜ | Seed + ingest populate DB/Chroma; FTS and filters work; reruns do not duplicate | — |
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
- [x] Docker Compose for Chroma (pinned image, volume, healthcheck, localhost bind) — `docker compose config` valid; daemon stopped
- [x] Model gateway: role→chain config, capability matrix, fallback, timeouts, provider quotas, record/replay (+ served-call log line)
- [x] CI skeleton: lint, typecheck, unit, build (green via `pnpm run ci`)
- [x] `docs/decisions.md` (seeded 2026-11-24, updated 2026-11-25)
- [ ] Acceptance: live gateway call + disabled-provider fallback proof (needs keys)

> Verified: DB schema/migrations/seed, CI, API boot, auth end-to-end, missing-env fail-fast, gateway error mapping. Pending: live provider call/fallback and Chroma healthcheck (Docker daemon).

## Session log

| Date | Phase | What changed | Files | Next |
|---|---|---|---|---|
| 2026-11-24 | 0 | Created the context layer, tracker, and README pointer | `AGENTS.md`, `context/*`, `docs/decisions.md`, `README.md` | Start Phase 1: scaffold workspace |
| 2026-11-24 | 1 | Completed the CI skeleton: fixed Biome 2.6.9 config, strict typecheck (shared build ordering, Nest/Prisma/LangChain types), shared DTO empty-string normalization; added 9 model-gateway unit tests (fallback, breaker, replay, capabilities) and made `NO_CASSETTE` fail fast | `biome.json`, `package.json`, `packages/shared/src/dto.ts`, `apps/api/src/**`, `apps/api/src/model-gateway/*.spec.ts` | Add Prisma migrations for User/Address |
| 2026-11-24 | 1 | Added the initial Prisma migration (`users`, `addresses`, unique indexes, cascade FK) plus an idempotent Phase 1 seed and a migration smoke test; verified `pnpm db:migrate` (deploy) and `pnpm db:reset` on fresh SQLite files | `apps/api/prisma/migrations/**`, `apps/api/prisma/seed.ts`, `apps/api/src/db/migrations.spec.ts`, `apps/api/package.json`, `apps/api/tsconfig*.json`, `README.md` | Scaffold `apps/web` login/register pages |
| 2026-11-25 | 1 | Made the API boot for real: dotenv before zod validation, value imports for Nest DI, `rootDir: src` build, public 5xx codes in the exception filter (+3 specs), served-call gateway log; Biome parses Tailwind CSS | `apps/api/src/main.ts`, `apps/api/src/**`, `apps/api/tsconfig.build.json`, `biome.json` | Finish the web scaffold and verify auth |
| 2026-11-25 | 1 | Committed the Next.js web app (home, login, register with address), synced the design system, verified auth end-to-end through the Next `/api/*` proxy; `pnpm run ci` green | `apps/web/**`, `design-system/shopping-agent/MASTER.md`, `.env.example`, `pnpm-lock.yaml` | Add keys; live gateway + fallback acceptance |

## Blockers and open questions

- **API keys (Phase 1 gate):** `GROQ_API_KEY` and `GOOGLE_API_KEY` are empty in `.env`; the live gateway call and the disabled-provider fallback cannot be proven yet.
- **Docker daemon:** stopped locally. `docker compose config` is valid, but the Chroma healthcheck has not run; start Docker before Phase 2 ingest.
- **Model IDs / free-tier limits:** verify against each provider's live model list once keys exist; record `verified_at` in `models.config.ts` (current entries were written 2026-11-24).
- **Budgets/limits:** proposed values are in `PLAN.md` §10/§20; re-measure after Phase 1.
- **Cancel window:** proposed 30 minutes; confirm during Phase 6.

## Update protocol

1. Mark the task/phase status and add evidence.
2. Add a session-log row (date, phase, what changed, files, next).
3. Append decisions/assumptions to `docs/decisions.md`.
4. Update the affected context topic file only if behavior or a contract changed.
5. Keep this file ≤120 lines; move detail to the topic files or decision log.
