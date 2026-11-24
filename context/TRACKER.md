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
- **Status:** 🟨 in progress
- **Next action:** Add Prisma migrations for `User`/`Address` and verify `pnpm db:migrate` on a fresh SQLite file.
- **Blockers:** none
- **Open decisions:** model IDs/free-tier limits still need a live verification pass; embedding provider decided (Gemini).

## Done so far

- `PLAN.md` v5 is the approved specification.
- Context layer exists: `AGENTS.md`, `context/*`, `docs/decisions.md`.
- Phase 1 scaffold: pnpm workspace, strict TS, Biome, `packages/shared`, NestJS API with env validation, pino, Prisma service, auth (register/login/logout/me), gateway (chains/fallback/breaker/record-replay), Docker Compose for Chroma.
- **CI pipeline green**: `pnpm run ci` (lint → typecheck → unit tests → build) passes locally; 15 unit tests (6 shared DTO, 9 model gateway).

## Phase progress

| Phase | Status | Acceptance gate (short) | Evidence |
|---|---|---|---|
| 0 — Planning | ✅ | PLAN.md v5 approved | `PLAN.md` |
| 1 — Foundation | 🟨 | Gateway test endpoint + fallback + logged call + missing env fails fast + CI green | `pnpm run ci` green; 15 unit tests |
| 2 — Data and Catalog | ⬜ | Seed + ingest populate DB/Chroma; FTS and filters work; reruns do not duplicate | — |
| 3 — RAG Chat | ⬜ | 10 policy questions correct with sources; out-of-scope redirect; no-match answer; hit-rate reported | — |
| 4 — Read-only Agents | ⬜ | Search/review/history work via `/assistant`; `agent_runs` recorded; retry deduped; concurrent session 409 | — |
| 5 — Cart | ⬜ | UI + chat cart ops; limits; persistence; cross-user 404; footer | — |
| 6 — Order and Checkout | ⬜ | Direct order + cart checkout + all limits + cancel + injection tests | — |
| 7 — Guardrails, Evals, Polish | ⬜ | Eval targets met; malicious review cannot order; demo script; CI green | — |

## Phase 1 checklist

- [x] pnpm monorepo, TypeScript strict, lint/format (Biome), `packages/shared` wiring, `.nvmrc`, `packageManager`, `engines`
- [ ] NestJS config module + zod env validation
- [ ] pino logging with redaction
- [ ] Prisma + SQLite (WAL, `busy_timeout`, FK), Prisma Migrate, `PrismaService` singleton
- [ ] Auth: register/login/logout/me, JWT cookie, guard
- [ ] Next.js login/register pages (registration includes address)
- [ ] Docker Compose for Chroma (pinned image, volume, healthcheck, localhost bind)
- [ ] Model gateway: role→chain config, capability matrix, fallback, timeouts, provider quotas, record/replay
- [x] CI skeleton: lint, typecheck, unit, build (green via `pnpm run ci`)
- [x] `docs/decisions.md` (seeded 2026-11-24)
- [ ] Acceptance: logged-in user calls a test endpoint through the gateway; disabling one provider key still responds via fallback; call logged with provider/model; missing env fails fast; CI green

> Scaffolded but not yet verified at runtime: env validation, pino, Prisma service, auth API, Docker Compose, gateway live path. Unit coverage so far: shared DTOs + model gateway.

## Session log

| Date | Phase | What changed | Files | Next |
|---|---|---|---|---|
| 2026-11-24 | 0 | Created the context layer, tracker, and README pointer | `AGENTS.md`, `context/*`, `docs/decisions.md`, `README.md` | Start Phase 1: scaffold workspace |
| 2026-11-24 | 1 | Completed the CI skeleton: fixed Biome 2.6.9 config, strict typecheck (shared build ordering, Nest/Prisma/LangChain types), shared DTO empty-string normalization; added 9 model-gateway unit tests (fallback, breaker, replay, capabilities) and made `NO_CASSETTE` fail fast | `biome.json`, `package.json`, `packages/shared/src/dto.ts`, `apps/api/src/**`, `apps/api/src/model-gateway/*.spec.ts` | Add Prisma migrations for User/Address |

## Blockers and open questions

- **Embedding provider:** choose Gemini or local Transformers.js before Phase 2. No runtime fallback.
- **Model IDs / free-tier limits:** verify at build time and record `verified_at` in `models.config.ts`.
- **Budgets/limits:** proposed values are in `PLAN.md` §10/§20; re-measure after Phase 1.
- **Cancel window:** proposed 30 minutes; confirm during Phase 6.

## Update protocol

1. Mark the task/phase status and add evidence.
2. Add a session-log row (date, phase, what changed, files, next).
3. Append decisions/assumptions to `docs/decisions.md`.
4. Update the affected context topic file only if behavior or a contract changed.
5. Keep this file ≤120 lines; move detail to the topic files or decision log.
