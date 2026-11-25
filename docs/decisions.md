# Decisions

ADR-lite log. Append only. Format: date, status, decision, why, alternatives.

## 2026-11-24 — Build to PLAN.md v5

**Status:** accepted
**Decision:** Treat `PLAN.md` v5 as the canonical build specification.
**Why:** It resolves the v5 design questions (direct agent actions, buffered output guardrails, deterministic intent resolution, Prisma/SQLite, single-instance deployment).
**Alternatives:** earlier plan versions; ad-hoc implementation without a spec.

## 2026-11-24 — Context layout

**Status:** accepted
**Decision:** Use `AGENTS.md` as the entry point, `context/*` for thin topic docs and the tracker, and `docs/decisions.md` for assumptions/deviations.
**Why:** Keeps onboarding navigable, avoids one large context file, and separates stable docs from mutable progress.
**Alternatives:** a single `CONTEXT.md`; putting the tracker in `README.md`.

## 2026-11-24 — Embedding provider

**Status:** accepted
**Decision:** **Gemini embeddings** (`EMBEDDING_PROVIDER=gemini`), fixed model, no runtime fallback.
**Why:** Quality and simplicity; `GOOGLE_API_KEY` is already provisioned for the LLM gateway. Local Transformers.js kept as a documented alternative only if an offline demo becomes required (would need a full re-index).
**Alternatives:** local Transformers.js (offline, heavier startup).

## 2026-11-24 — Lint/format stack

**Status:** accepted
**Decision:** **Biome** for lint + format across the monorepo (PLAN §16 allows Biome or ESLint+Prettier).
**Why:** One fast tool, minimal config, no plugin drift; fits a small strict-TS monorepo.
**Alternatives:** ESLint + Prettier (rejected: more config surface for no MVP benefit).

## 2026-11-24 — LLM providers for Phase 1

**Status:** accepted
**Decision:** Provision **Groq** and **Google Gemini** keys first; gateway chains are config-driven so Cerebras/OpenRouter can be added later without code changes. Tests default to `LLM_MODE=replay`.
**Why:** Phase 1 acceptance needs one live call plus a fallback (disable one provider key, still responds). Groq primary for tool calling, Gemini fallback/embeddings.
**Alternatives:** all four providers at once (deferred); replay-only acceptance (rejected: PLAN §16 requires a live fallback proof).

## 2026-11-24 — UI visual direction

**Status:** accepted
**Decision:** **Minimal & clean** visual direction for all pages, driven by the local `ui-ux-pro-max` skill (`.opencode/skills/ui-ux-pro-max`) so styles stay consistent across pages and sessions.
**Why:** Neutral palette + whitespace lets catalog/chat content lead; PLAN forbids agent-specific UI, so a calm base suits both store pages and plain-text chat.
**Alternatives:** editorial, bold/vibrant, dark modern (rejected for MVP demo clarity).

## 2026-11-24 — Model IDs and free-tier limits

**Status:** accepted (2026-11-25 verification)
**Decision:** Pin Groq `openai/gpt-oss-20b` / `openai/gpt-oss-120b` and Gemini `gemini-3.5-flash-lite` / `gemini-3.6-flash`; embeddings `gemini-embedding-001` at 768 dimensions. `verified_at = 2026-11-25`.
**Evidence:** IDs checked against the providers' published model lists; live calls served `groq/openai/gpt-oss-20b` (router), `gemini/gemini-3.5-flash-lite` (router fallback with `PROVIDER_DISABLE=groq`), and `gemini/gemini-3.6-flash` (explicit); a live `embedContent` call with `outputDimensionality: 768` returned 768 values.
**Still open:** exact free-tier quotas/TPM were not measured; keep the conservative `PROVIDER_DAILY_TOKEN_BUDGET` and per-user budgets until Phase 2 usage data exists.
**Alternatives:** `gemini-embedding-2` (newer multimodal, but no index exists yet and the plan fixes one model; revisit before Phase 2 ingest only if desired).

## 2026-11-24 — CI pipeline and formatter scope

**Status:** accepted
**Decision:** Root `typecheck` builds `packages/shared` before the recursive run (nodenext resolves its `dist`). Biome formats/lints code only; Markdown and YAML are excluded from formatting. The model gateway rethrows `NO_CASSETTE` instead of folding it into `ALL_MODELS_FAILED`.
**Why:** A green `pnpm run ci` is the Phase 1 exit condition; formatting the spec produced 365 lines of unrelated churn; and replay failures must reach callers as `LLM_MODE_NO_CASSETTE` rather than a generic provider error.
**Alternatives:** tsconfig `paths` to the shared source (breaks the Nest runtime without a build); formatting all files (rejected: documentation churn).

## 2026-11-24 — Initial migration scope, Phase 1 seed, and migrations smoke test

**Status:** accepted
**Decision:** The first migration (`20261124170850_init_user_address`) creates only `users` and `addresses` with their unique indexes and a cascading FK; FTS5, triggers, and other invariant SQL stay in Phase 2 custom migrations. Add a minimal idempotent seed (3 demo users with addresses) so `pnpm db:reset` has something to run, and make `db:reset` explicitly `prisma migrate reset --force && prisma db seed` because Prisma 7.10 does not invoke the configured seed on reset. A unit spec applies the real migration SQL to an in-memory `node:sqlite` database (no live DB, network, or Prisma CLI).
**Why:** Phase 1 needs a verifiable auth schema, not the full catalog; a green `db:migrate`/`db:reset` is the gate, and the in-memory spec catches index/FK regressions before migrations reach a real file.
**Alternatives:** `prisma db push` (forbidden by PLAN §18); adding FTS5/triggers now (deferred to Phase 2 as specified); `db:reset` with `--skip-seed` (rejected: weakens the documented reset semantics); better-sqlite3 as a direct test dependency (rejected: `node:sqlite` needs no extra package on Node 24+).

## 2026-11-25 — Design system synced to the implemented minimal direction

**Status:** accepted
**Decision:** `design-system/shopping-agent/MASTER.md` now documents the implemented neutral palette (`#FAFAF9` background, near-black primary, violet `#6D28D9` accent) and the Rubik + Nunito Sans pairing. The originally generated AI-purple surface / cyan CTA palette is recorded as rejected.
**Why:** The generated system and the code disagreed; the approved direction in the 2026-11-24 decision is minimal & clean, and PLAN §12 forbids agent-specific chrome. One persisted source of truth prevents future pages from drifting toward the purple/cyan theme.
**Alternatives:** re-theme the app to the generated palette (rejected: worse content contrast for catalog/chat); delete the design-system folder (rejected: loses the ui-ux-pro-max guidance).

## 2026-11-25 — API boot path, DI imports, and public 5xx codes

**Status:** accepted
**Decision:** `main.ts` loads `.env` (package-local first, then repo root) with `dotenv` **before** `validateEnv`; the build tsconfig sets `rootDir: src` so `nest build` emits `dist/main.js`; Nest constructor-injected classes use value imports and Biome's `useImportType` is disabled for `apps/api/src/**`; `AllExceptionsFilter` preserves contract 5xx codes (`PROVIDER_UNAVAILABLE`, `BUDGET_EXHAUSTED`, `LLM_MODE_NO_CASSETTE`) while replacing their text with friendly messages, and collapses everything else to `INTERNAL_ERROR`.
**Why:** `pnpm start` failed at runtime even though tests and builds passed: ConfigModule's `forRoot` had not populated `process.env` when `validateEnv` ran, Biome had rewritten injected classes to `import type` (so Nest saw `Function`), and the build emitted `dist/src/main.js` while `package.json` pointed at `dist/main.js`. The filter was also converting a deliberate `503 PROVIDER_UNAVAILABLE` into `INTERNAL_ERROR`, hiding the Phase 1 acceptance contract.
**Alternatives:** running the API with `tsx` only (rejected: production start must work); global `useImportType: off` (rejected: keeps type-only imports enforced in web/shared); `entryFile` override in `nest-cli.json` (workable, but `rootDir` also keeps `prisma.config.ts` out of the build).

## 2026-11-25 — Gateway success logging

**Status:** accepted
**Decision:** `ModelGatewayService.generate` logs one line per served call with `chain`, `provider`, `model`, `attempt`, and `elapsedMs`.
**Why:** PLAN §6/§16 requires the Phase 1 test call to be logged with provider and model; previously only fallback warnings were logged.
**Alternatives:** log only in the controller (rejected: misses direct service use and fallback attempts).
