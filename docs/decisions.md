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

**Status:** open
**Decision:** Verify availability, capabilities, and quotas at build time; record `verified_at` in `models.config.ts`.
**Why:** Free-tier model IDs and limits change frequently; do not rely on memory.
**Alternatives:** pin to a known-good set after verification.

## 2026-11-24 — CI pipeline and formatter scope

**Status:** accepted
**Decision:** Root `typecheck` builds `packages/shared` before the recursive run (nodenext resolves its `dist`). Biome formats/lints code only; Markdown and YAML are excluded from formatting. The model gateway rethrows `NO_CASSETTE` instead of folding it into `ALL_MODELS_FAILED`.
**Why:** A green `pnpm run ci` is the Phase 1 exit condition; formatting the spec produced 365 lines of unrelated churn; and replay failures must reach callers as `LLM_MODE_NO_CASSETTE` rather than a generic provider error.
**Alternatives:** tsconfig `paths` to the shared source (breaks the Nest runtime without a build); formatting all files (rejected: documentation churn).
