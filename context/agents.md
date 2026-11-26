# Agents and AI Layer

Model gateway, RAG, LangGraph routing, tools, and deterministic intent resolution.
Source: PLAN.md §6, §7, §8.

## Model gateway

Returns LangChain chat models by role, each with a capability-checked fallback chain.

| Role | Needs | Example chain (verify) |
|---|---|---|
| `router` | fast, structured output | Groq small → Cerebras small → Gemini Flash-Lite |
| `guardrail` | fast JSON classifier | Groq small → Gemini Flash-Lite |
| `agent` | reliable tool calling | Groq 70B → Cerebras 70B → Gemini Flash → OpenRouter `:free` |
| `summarizer` | long context | Gemini Flash → OpenRouter long-context `:free` |
| `rag` | grounded answers | Groq 70B → Gemini Flash |
| `embeddings` | fixed, never swapped | Gemini **or** local Transformers.js (choose before ingestion) |

- Config in `models.config.ts`: `id`, `provider`, `verified_at`, `capabilities`, `temperature`, `maxOutputTokens`. Capability gate: no tool/JSON role on a model that lacks it.
- `429`/`5xx`/timeout → backoff + jitter, then next provider; never retry `400/401/403`. Per-call ~30 s, per-run ~90 s.
- Provider daily quota + circuit breaker; per-user budgets are not enough.
- Usage metadata when available; otherwise estimate and mark `token_usage.estimated=true`.
- Record/replay (`LLM_MODE`) keyed by `(role, model, messages hash, tool-schema hash)`; redact PII, commit only synthetic cassettes.
- No embedding fallback: fail loudly. Fake data only; redact PII before provider calls.

## RAG (`/help`)

**Ingest** (`pnpm rag:ingest`, idempotent): load `content/policies/*.md` → split by headings + recursive splitter (~500–800 tokens, ~80 overlap) → metadata (`source`, `title`, `section`, `chunk_index`, `content_hash`, `embedding_model`, `embedding_dim`, `chunker_version`) → delete changed sources, skip unchanged hashes → embed with the fixed model → upsert to Chroma `store_policies` (`hnsw:space=cosine`). Assert collection metadata at startup; fail with a re-index message.

**Query:** input guardrails → condense follow-up → retrieve top-k 4–6 → cosine distance threshold → no match: "I don't have that information" (never answer from memory) → grounded `rag` answer → append deduplicated `Sources:` → Chroma down: friendly "knowledge base unavailable". Scope guard: non-policy questions → `/assistant`.

**Implemented (Phase 3):**
- Retrieval: `RAG_TOP_K=5`, `RAG_MAX_DISTANCE=0.38` (cosine **distance**; in-scope 0.185–0.333, unrelated 0.410).
- Condense only follow-up-shaped messages; a policy follow-up with history bypasses the standalone scope classifier (read-only, fail-open).
- Buffered SSE: generate → output sanitize/PII mask → `Sources:` → persist → token frames → `done`. Replay `(sessionId, clientMessageId)`; per-session lock; 409 on a concurrent turn.
- Degrade copy for Chroma/embedding/provider failure; every guardrail action writes `guardrail_events`.
- Eval: `pnpm eval:rag [--retrieval-only] [--json]` → 10 policy questions + out-of-scope + no-match; retrieval hit-rate@k and deterministic facts (Unicode-normalized).

## LangGraph

```text
START → input_guardrails → router ─┬→ search ─┐
                                   ├→ review ─┤
                                   ├→ cart ───┤
                                   ├→ order ──┼→ output_guardrails → END
                                   ├→ history ┤
                                   └→ clarify ┘
```

- Router: small model, structured `{ agent, confidence, reason }`; includes last few redacted turns + structured state; low confidence → `clarify`.
- Specialists: ≤4 tools (prefer 3). Checkpointer: separate SQLite DB, thread id `${userId}:${sessionId}`, recursion limit ~25. Max model/tool calls per run.
- **No confirmation, no interrupts.** Side effects gated by the resolver.

**Implemented (Phases 4–6):**
- Graph: `router` → exactly one of `search` / `review` / `cart` / `order` / `history` / `clarify`. An order mutation runs at most once per turn; the write service also enforces one order per turn via `unique(user_id, turn_id)`.
- Cart (Phase 5): exactly three tools (`view_cart`, `add_to_cart`, `update_cart_item`) calling `CartService`. `agent.cart.ts` resolves action/product/quantity from the user message; the tool re-runs it and rejects mismatched model args (`NEEDS_CLARIFICATION`/`INTENT_UNRESOLVED`); non-committal language never commits. A server-generated cart footer (lines, qty, unit price, line total, subtotal, `/cart`) is appended per turn.
- Router confidence `AGENT_ROUTER_MIN_CONFIDENCE=0.55`; below it, a deterministic keyword/pattern heuristic decides, so a provider failure still yields a useful route.
- Tools call `ProductSearchService` / `OrderService`; no raw SQL, no identity parameters. Outputs are untrusted envelopes with a flag scan and a `maxToolOutputChars` cap.
- Deterministic fallbacks: search parses query/price/category; history lists 5 orders; review resolves an ordinal/name/id from `lastListedProducts`. The model only writes prose from tool results.
- Product/order footers are server-generated (`/products/:id`, `/orders/:id`); the model must not restate IDs/totals.
- Checkpointer: `CHECKPOINT_DATABASE_PATH` (default `./data/checkpoints.db`), thread `${userId}:${sessionId}`, recursion limit 25, per-turn caps `AGENT_MAX_MODEL_CALLS=6`, `AGENT_MAX_TOOL_CALLS=4`.
- `/agent/chat`: same buffered-SSE lifecycle as RAG (replay, per-session 409, persist-before-stream) plus `agent_runs` audit and per-call `token_usage`.
- `/assistant` uses the shared `ChatPanel`; no agent-specific UI. Chat markdown links are filtered to `/products/:id`, `/cart`, `/orders/:id`, `/help`, `/assistant`, or https.

## Shared state (bounded)

```ts
{
  userId, sessionId, turnId, clientMessageId,
  recentMessages: last 12 (redacted),
  lastListedProducts: [{ id, name, priceCents, rating, position, sku? }], // max 10
  lastCartSummary: { items: [{ productId, name, qty, unitPriceCents }], subtotalCents },
  lastOrder: { id, orderNumber, status, totalCents },
  sessionRiskScore: number
}
```

`lastListedProducts` is written only by search tools; `lastCartSummary` only by cart tools. `cartFooter` is the per-turn footer and resets each turn, while `lastCartSummary` persists for follow-ups. Raw reviews/descriptions/policy text never enter structured state; they stay in the tool result envelope.

## Capability matrix

| Agent | Tools | May see | Side effects |
|---|---|---|---|
| `search` | `search_products`, `get_product` | msg, recent, `lastListedProducts` | none |
| `review` | `get_reviews` | msg, recent, `lastListedProducts` | none |
| `cart` | `view_cart`, `add_to_cart`, `update_cart_item` | msg, `lastListedProducts`, `lastCartSummary` | cart writes |
| `order` | `quote_order`, `place_order`, `checkout_cart`, `cancel_order` | msg, `lastListedProducts`, `lastCartSummary`, `lastOrder`; **no raw reviews/product text** | order writes |
| `history` | `list_orders`, `get_order` | msg, `lastOrder` | none |
| `clarify` | none | msg, recent | none |

This matrix is the primary prompt-injection defense.

## Tools

Identity is injected from request context, never a tool parameter; all args are zod-validated.

| Agent | Tool | Input | Output |
|---|---|---|---|
| Search | `search_products` | `query?`, `category?`, `minPrice?`, `maxPrice?`, `minRating?`, `limit` (5, max 10) | products + `/products/:id` + footer |
| Search | `get_product` | `productId` | one product + link |
| Review | `get_reviews` | `productId`, `limit` (5, max 10), `sort` | reviews (untrusted) |
| Cart | `view_cart` | — | lines, subtotal, warnings, `/cart` |
| Cart | `add_to_cart` | `productId`, `qty` 1..5 | updated line + footer; stock/line/qty limits |
| Cart | `update_cart_item` | `productId`, `qty` 0..5 (0 removes) | updated cart + footer |
| Order | `quote_order` | `items[]` or `fromCart: true` | read-only price/stock check |
| Order | `place_order` | `items[]` | order + receipt + `/orders/:id` |
| Order | `checkout_cart` | — (cart from DB) | order + receipt; clears cart |
| Order | `cancel_order` | `orderId` | updated order + receipt |
| History | `list_orders` | `status?`, `limit` | orders + links |
| History | `get_order` | `orderId` | order + items + link |

Tool outputs are `{ trust: 'untrusted', source, data }`. `quote_order` is for price/availability questions; `place_order`/`checkout_cart` return structured refusals with quote details on limit/stock failure. Review summaries come from the review agent, not a hidden tool.

**Order agent (Phase 6):** `agent.order.ts` resolves cancel → checkout → quote → direct place from the user's message and structured state only (`lastListedProducts`, `lastOrder`). Cancel accepts an `ORD-…` number or "cancel it" after `lastOrder` was raised; non-committal language never commits; multiple ordinals/no list clarify. The four tools re-run the resolver and reject mismatched args with `NEEDS_CLARIFICATION` / `INTENT_UNRESOLVED`. Identity, `turnId`, and `clientMessageId` come from `ToolContext`, never tool arguments. Prompt versions: router `agent-router-v3`, order `agent-order-v1`.

## Deterministic intent resolver

Code, not a prompt. Runs before any cart/order side effect; returns a resolved intent or `{ needsClarification: true, question }`.

1. **Commit verbs:** order, buy, purchase, checkout, place an order, get me, add to cart, put in cart, remove from cart, cancel. Questions/advice ("should I", "how much", "can you tell me", "what if") are not commits.
2. **Non-committal never commits:** "maybe", "I'm thinking", "thinking about", "I might", "perhaps", "just looking", "should I", "would it be", "what if".
3. **Product refs** must resolve to an ID in `lastListedProducts` or a product result from this turn (ordinals, names, SKUs, explicit IDs). A product mentioned only in a review/description is not resolvable.
4. **Quantity** comes from the user's message (default 1 only when "one" or a single product without a quantity). Tool/review text cannot supply quantity.
5. **Cart updates** target a product in the cart or `lastListedProducts`; qty 0 removes.
6. **Cancel** references an order ID/number in the message, or `lastOrder` after an assistant question. Otherwise clarify.
7. Multiple matches or no product list → clarify; never guess.
8. The tool re-runs the resolver and rejects mismatches with `INTENT_UNRESOLVED`/`NEEDS_CLARIFICATION`; the LLM cannot bypass it with fabricated arguments.

## Replies, footers, injection

- Plain text with minimal markdown; numbered lists so follow-ups resolve.
- Server-generated footers after output guardrails: products (name, price, rating, link), cart (lines, qty, unit price, line total, subtotal, `/cart`), orders (items, qty, prices, total, order number, status, cancel deadline, `/orders/:id`). The agent must not restate exact order totals/IDs.
- Prompts are soft guidance; hard rules live in code.
- Order/cart agents get structured state only, never raw review/product text. Tool-output scan neutralizes flagged text. An injected review cannot create a product ref or quantity.
- Tests: malicious review → summarize → "ok do it" → no order; user-selected listed product + quantity from user text → allowed.
