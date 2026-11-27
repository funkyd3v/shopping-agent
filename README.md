# Shopping Agent

A demo store with an AI assistant that can actually shop for you. Ask it to find
products, summarize reviews, add items to your cart, place an order, check out,
cancel an order, or answer questions about shipping and returns. The assistant
works on the same data you see on the store pages.

An AI agent connected to real application code, with limits and safety checks
enforced in code rather than only in prompts.

> **Under active development.** This is an MVP demo, not a production store.
> Payments are simulated, all products and reviews are generated demo data, and
> some planned work (browser end-to-end tests, extra operational tooling) is
> still in progress. Please do not enter real personal information.

## Highlights

- **Multi-model AI agent:** work is routed across several AI models, with
  automatic fallback to another provider when one is unavailable.

## What you can try

- **Assistant chat:** “find wireless headphones under $80”, “add 2 of the second
  one to my cart”, “checkout my cart”, “cancel my last order”.
- **Help chat:** shipping, returns, warranty, payment and privacy questions,
  with the source documents listed under each answer.
- **Store pages:** browse products, manage the cart, and view orders — the same
  records the assistant reads and writes.

## Run it locally

You need **Node.js 24+**, **pnpm**, and **Docker** (only for the help chat's
knowledge base).

```bash
pnpm install
cp .env.example .env
# in .env: set JWT_SECRET (any random string of 32+ characters)
#          and add GROQ_API_KEY / GOOGLE_API_KEY for live chat
pnpm prisma:generate
pnpm docker:up
pnpm demo:reset
pnpm dev
```

Open <http://localhost:3000> and sign in with a demo account. The API runs on
port 3001. Two read-only checks are available at `/health` and `/health/chroma`.

If Docker is not available, the store, cart, orders and assistant still run;
only the help chat needs the local vector database.

### Demo accounts

All three accounts use the password `Demo1234!`.

| Email | Name |
| --- | --- |
| `alice@example.com` | Alice Chen |
| `bob@example.com` | Bob Rivera |
| `carol@example.com` | Carol Nguyen |

The seed is repeatable — running it again will not duplicate data.

## Tech and tools

- **Web:** Next.js, React, Tailwind CSS
- **API:** NestJS, TypeScript, Prisma, SQLite
- **AI:** LangChain.js, LangGraph.js, Chroma, Groq and Gemini models
- **Quality:** Vitest, Biome, GitHub Actions
- **Runtime:** Node.js 24, pnpm, Docker Compose

## Useful commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the web app and API together |
| `pnpm demo:reset` | Rebuild the demo database and knowledge base |
| `pnpm run ci` | Lint, type-check, test and build |
| `pnpm eval:guardrails` | Run the offline safety checks |
| `pnpm demo:smoke` | Check the running demo end to end |

Unit tests and offline evaluations need no API keys or network access.

## More detail

- [`PLAN.md`](./PLAN.md) — the build plan and acceptance criteria
- [`docs/demo-script.md`](./docs/demo-script.md) — a guided walkthrough
- [`docs/decisions.md`](./docs/decisions.md) — design choices and assumptions
