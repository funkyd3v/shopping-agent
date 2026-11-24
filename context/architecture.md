# Architecture

System shape, module boundaries, and request flows.
Source: PLAN.md §3, §4, §21.

## System

```text
Next.js (apps/web)
  /login /register
  /products /products/:id
  /cart
  /orders /orders/:id
  /help       → RAG chat
  /assistant  → agent chat
        │ SSE + REST
        ▼
NestJS (apps/api)
  AuthModule  ProductsModule  CartModule  OrdersModule  ReviewsModule
  RagModule   AgentModule    GuardrailsModule
  ModelGatewayModule  UsageModule  LoggingModule
  Domain services:
    ProductSearchService  CartService  OrderService  CheckoutService
    IntentResolverService
        │
        ├─ SQLite/Prisma (data + FTS5 + checkpoints)
        ├─ ChromaDB (policy chunks)
        └─ LLM providers (Groq/Cerebras/Gemini/OpenRouter)
```

## Module boundaries

- **Domain services are the single source of truth.** REST controllers and agent tools both call them; never duplicate cart/order logic in a tool.
- **Auth** issues a JWT in an httpOnly cookie and provides the request context used to inject `userId`, `sessionId`, `turnId`, `clientMessageId`.
- **Model gateway** maps a role (`router`, `guardrail`, `agent`, `summarizer`, `rag`, `embeddings`) to a capability-checked fallback chain.
- **Guardrails** wrap the graph and tools; policy values live in `guardrails.policy.ts` with env overrides.
- **Usage/logging** record `token_usage`, `agent_runs`, `guardrail_events`, and structured pino logs.

## Agent chat flow

```text
User msg (+ clientMessageId) → JWT auth → per-session lock
  → input guardrails (budget, PII redact, jailbreak)
  → router (small model, structured output)
  → specialist tool loop (non-streamed)
  → deterministic intent resolver before any cart/order side effect
  → tools act directly (identity from context; limits in services)
  → buffered final answer
  → output guardrails (PII mask, redundancy, link validation, injection scan)
  → server-generated facts footer
  → persist message → stream sanitized text → done
```

## Cart checkout flow

```text
"Checkout" on /cart OR "check out my cart" in chat
  → JWT auth → per-session lock (chat only)
  → CheckoutService: interactive transaction + process-wide write mutex
      load cart → reprice → enforce limits → check stock
      → create order + items → decrement stock → clear cart
  → receipt (server-generated) → chat footer or /orders/:id redirect
```

On any failure the transaction rolls back and the cart stays unchanged.

## Repository layout

```text
/
├─ PLAN.md
├─ AGENTS.md
├─ context/
├─ docs/decisions.md
├─ docker-compose.yml
├─ pnpm-workspace.yaml
├─ .nvmrc  .env.example  .gitignore
├─ content/policies/*.md
├─ packages/shared/          # zod: SSE events, DTOs, error codes
├─ apps/
│  ├─ api/
│  │  ├─ prisma/             # schema, migrations, seed
│  │  └─ src/
│  │     ├─ auth/ users/ products/ reviews/ cart/ orders/
│  │     ├─ db/              # PrismaService, FTS helpers
│  │     ├─ model-gateway/
│  │     ├─ rag/
│  │     ├─ agent/           # graph, agents, tools, prompts, resolver, SSE controller
│  │     ├─ guardrails/
│  │     └─ usage/ logging/
│  └─ web/
│     └─ src/app/{login,register,products,cart,orders,help,assistant}/
├─ evals/                    # datasets, cassettes, runners
└─ tests/                    # shared fixtures/helpers
```

## Deployment (single instance)

- One VM runs NestJS, Next.js, Chroma (Docker), and a reverse proxy.
- `data/app.db` and `data/checkpoints.db` live on a persistent volume.
- Chroma binds to `127.0.0.1:8000` only; API and web are the only public services.
- No serverless, no multi-instance API, no shared external queue. Scaling requires Postgres + shared checkpointer + external vector DB (out of scope).
