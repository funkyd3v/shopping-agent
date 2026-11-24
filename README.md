# shopping-agent

AI-agent e-commerce MVP. Canonical spec: [`PLAN.md`](./PLAN.md).

**Start here:** [`AGENTS.md`](./AGENTS.md) → [`context/TRACKER.md`](./context/TRACKER.md) → [`context/README.md`](./context/README.md).

Bootstrap, demo credentials, and runbook are added in Phase 1/7 (see `PLAN.md` §21).

## Local demo accounts

`pnpm db:reset` (migrate + seed) creates three accounts, all with password `Demo1234!`:

| Email | Name |
|---|---|
| `alice@example.com` | Alice Chen |
| `bob@example.com` | Bob Rivera |
| `carol@example.com` | Carol Nguyen |

The seed is idempotent; reruns do not duplicate users or addresses.
