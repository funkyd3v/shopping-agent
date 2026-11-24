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

**Status:** open
**Decision:** TBD before Phase 2: Gemini embeddings or local Transformers.js.
**Why:** One fixed embedding model; no runtime fallback; changing it requires a full re-index.
**Alternatives:** see PLAN §20.

## 2026-11-24 — Model IDs and free-tier limits

**Status:** open
**Decision:** Verify availability, capabilities, and quotas at build time; record `verified_at` in `models.config.ts`.
**Why:** Free-tier model IDs and limits change frequently; do not rely on memory.
**Alternatives:** pin to a known-good set after verification.
