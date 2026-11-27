# shopping-agent

AI-agent e-commerce MVP. Canonical spec: [`PLAN.md`](./PLAN.md).

**Start here:** [`AGENTS.md`](./AGENTS.md) → [`context/TRACKER.md`](./context/TRACKER.md) → [`context/README.md`](./context/README.md).

Two chats share one UI: `/help` answers store policies from Chroma (RAG), and
`/assistant` routes across search, review, cart, order and history agents.
Payments are mocked; do not enter real personal data.

## Local demo accounts

`pnpm db:reset` (migrate + seed) creates three accounts, all with password `Demo1234!`:

| Email | Name |
|---|---|
| `alice@example.com` | Alice Chen |
| `bob@example.com` | Bob Rivera |
| `carol@example.com` | Carol Nguyen |

The seed is idempotent; reruns do not duplicate users or addresses.

## Bootstrap (local)

```bash
pnpm install
cp .env.example .env        # set JWT_SECRET (>=32 chars) and provider keys
pnpm prisma:generate
pnpm docker:up              # Chroma at 127.0.0.1:8000
pnpm demo:reset             # migrate reset + seed + idempotent Chroma ingest
pnpm dev                    # API :3001, web :3000 (shared watcher)
```

Open http://localhost:3000 and sign in with a demo account. `/health` (API+DB)
and `/health/chroma` (index readiness) are public and read-only.

If Docker is unavailable, Phase 3 was verified with a local
`chromadb==1.5.9` server on `127.0.0.1:8000`; the app contract is unchanged.

### Full Docker Compose demo

```bash
docker compose -f compose.demo.yml up -d
# one-time bootstrap inside the api service (the named volume shadows host data):
docker compose -f compose.demo.yml run --rm api \
  sh -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm prisma:generate && pnpm db:reset && pnpm rag:ingest'
docker compose -f compose.demo.yml up
```

This brings up Chroma + API + web with an `api-data` volume for both SQLite
files. Chroma stays bound to `127.0.0.1` on the host; the API reaches it at
`http://chroma:8000` inside the compose network. See [`compose.demo.yml`](./compose.demo.yml).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Shared build watcher + API (:3001) + web (:3000) |
| `pnpm db:reset` / `pnpm db:seed` | Rebuild / reseed SQLite (idempotent) |
| `pnpm rag:ingest` / `pnpm rag:ingest:reset` | Idempotent policy ingest (7 sources, 52 chunks) |
| `pnpm demo:reset` | `db:reset` + `rag:ingest` for a clean demo |
| `pnpm run ci` | Biome → typecheck → Vitest → build |
| `pnpm eval:guardrails` | Offline jailbreak/PII/redundancy/orders/cart pass rates (writes `evals/results/guardrails.json`) |
| `pnpm eval:agents` | 15 replay agent scenarios (writes `evals/results/agents.json`) |
| `pnpm eval:rag` | Live RAG retrieval + fact eval (needs Chroma + keys) |
| `pnpm guardrails:inspect --rule jailbreak --limit 20` | Read-only `guardrail_events` audit |
| `pnpm demo:smoke` | HTTP smoke of the end-to-end demo against a running API |

All unit and eval suites use `LLM_MODE=replay` and need no keys or network.
`pnpm eval:rag` is the only live eval (Chroma + embedding + provider keys).
`pnpm demo:smoke --help` lists options; scenarios that need a cassette or
provider that is not configured report `SKIP` instead of `FAIL`.

## Demo script

[`docs/demo-script.md`](./docs/demo-script.md) walks through all Phase 7
scenarios with copy-pasteable curl commands and expected results: RAG,
search/review, cart add/update/checkout, direct order, over-limit refusal,
non-committal language, malicious review + "ok do it", jailbreak, PII, loop,
budget exhaustion, provider failure, and abort/persist.

## Guardrails and safety

Rules are enforced in code, not prompts: PII redaction before providers and on
output, token budgets, jailbreak pre-filter (with an opt-in small-model
classifier), tool-output scanning, deterministic cart/order resolvers, server
limits, output sanitizer, and redundancy short-circuit. Every action writes a
`guardrail_events` row plus a structured log line. See
[`context/guardrails.md`](./context/guardrails.md) and
[`docs/decisions.md`](./docs/decisions.md).

Key env overrides (all validated by zod; defaults in the policy files):

| Var | Default | Purpose |
|---|---|---|
| `LLM_MODE` | `live` | `replay` for tests/demos without network |
| `PROVIDER_DISABLE` | empty | Comma-separated ids to force fallback (e.g. `groq`) |
| `JAILBREAK_THRESHOLD` | `0.8` | Block score |
| `JAILBREAK_LIVE_CLASSIFIER` | `false` | Opt-in `guardrail` chain for gray-zone text |
| `REDUNDANCY_SIMILARITY_THRESHOLD` | `0.9` | Normalized-token Jaccard short-circuit |
| `REQUEST_TOKEN_BUDGET` / `SESSION_TOKEN_BUDGET` / `DAILY_TOKEN_BUDGET` | 16k / 150k / 500k | Usage limits |
| `RUN_DEADLINE_MS` | 90000 | Per-run wall-clock limit; friendly SSE error on expiry |
| `MAX_ORDER_USD` / `MAX_QTY_PER_ITEM` / `CANCEL_WINDOW_MINUTES` | 200 / 5 / 30 | Order limits |
| `RATE_LIMIT_AUTH` / `RATE_LIMIT_CHAT` / `RATE_LIMIT_CART` / `RATE_LIMIT_CHECKOUT` | 10 / 20 / 60 / 10 | Requests per minute, per user (or IP when public) |

## Troubleshooting

- **Chat returns a friendly refusal with no answer:** check `pnpm guardrails:inspect`
  for the rule (`jailbreak`, `budget`, `rag.scope`, `redundancy.*`).
- **`/help` says the knowledge base is unavailable:** Chroma is down or the
  index metadata drifted; re-run `pnpm rag:ingest` and check `/health/chroma`.
- **Replay tests fail with `LLM_MODE_NO_CASSETTE`:** the message/prompt changed;
  re-record a synthetic cassette (never commit real PII) or use live mode.
- **Provider failure:** set `PROVIDER_DISABLE=groq` to exercise Gemini fallback;
  the gateway logs `chain`, `provider`, `model` and `attempt` for each served call.

Deployment topology and ops notes: [`PLAN.md`](./PLAN.md) §21.
