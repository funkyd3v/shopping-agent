# Context Map

Thin, navigable context for coding agents. **`PLAN.md` is canonical**; these files distill and link to it.
Last synced with PLAN v5: 2026-11-24.

## Source of truth

1. Code and tests — actual behavior.
2. [`PLAN.md`](../PLAN.md) — intended specification.
3. [`docs/decisions.md`](../docs/decisions.md) — approved deviations and assumptions.
4. `context/*.md` — navigation and distilled rules; fix if stale.
5. [`TRACKER.md`](./TRACKER.md) — progress; update every session.

If the tracker disagrees with code, the code wins — fix the tracker.

## Read this when…

| You need to… | Read |
|---|---|
| Know what is done and where to start | [`TRACKER.md`](./TRACKER.md) |
| Understand the product, scope, and stack | This file + PLAN §1–2 |
| Change system shape, modules, or deployment | [`architecture.md`](./architecture.md) |
| Touch the schema, migrations, or seed | [`data.md`](./data.md) |
| Change models, RAG, agents, tools, or intent resolution | [`agents.md`](./agents.md) |
| Change cart, order, checkout, or cancellation logic | [`commerce.md`](./commerce.md) |
| Change guardrails, limits, or evals | [`guardrails.md`](./guardrails.md) |
| Add/modify endpoints, SSE, pages, or env vars | [`interfaces.md`](./interfaces.md) |
| Know why a choice was made | [`docs/decisions.md`](../docs/decisions.md) |

## Project snapshot

- **What:** an AI-agent e-commerce MVP. E-commerce exists to give agents real actions: search products, answer from reviews, manage a cart, place orders, check out, cancel, and show history.
- **Two chats:** `/help` is RAG over store policies; `/assistant` is the multi-agent chat.
- **Normal pages stay:** `/products`, `/cart`, `/orders` show the real data agents create and read.
- **Stack:** Next.js App Router + Tailwind (web); NestJS (api); LangChain.js + LangGraph.js; Prisma + SQLite; ChromaDB (Docker); pnpm workspaces; TypeScript strict.
- **Agents act directly:** no confirmation UI or yes/no step. Code-enforced limits and a deterministic intent resolver provide safety.
- **Deployment:** single instance. Serverless and horizontal scaling are non-goals.

## Non-goals (MVP)

Real payments, admin dashboard, inventory management, shipping integrations, confirmation UI, agent-specific UI, review writing by the agent, wishlist/coupons/gift cards/multi-currency/guest cart, multi-language, horizontal scaling.

## Thinness rules

- Target ≤120 lines per file; each topic file starts with a one-line purpose and `Source: PLAN.md §x`.
- Link to `PLAN.md` sections; do not copy long prose.
- Prefer tables, checklists, and short bullets.
- Keep stable topic docs separate from the mutable tracker and the append-only decision log.
- When behavior or a contract changes, update the matching topic file and the tracker in the same change.
