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

## 2026-11-25 — Phase 2 schema, seed, and migration workflow

**Status:** accepted
**Decision:** Add the orders/chat/usage/audit tables through a **hand-written** migration (`20261125170000_add_orders_chat_usage`) with `BEFORE INSERT/UPDATE` triggers for enum-like values and invariants. Seed 8 historical orders across `placed/cancelled/shipped/delivered` with fixed timestamps and immutable address/item snapshots, plus 5 fixture reviews (prompt injection, benign-but-suspicious, PII, HTML/markdown injection, safe markdown link). `order_items` are deleted/recreated inside each seed upsert so reruns cannot duplicate lines.
**Why:** `prisma migrate dev` detects the FTS5 shadow tables as drift and refuses non-interactive runs; triggers are the only SQLite-native way to enforce the enum/positive-quantity/`cancelled_at` invariants, and fixed timestamps keep demos and evals reproducible. Seeded `placed` orders intentionally have expired cancel windows; Phase 6 demos create fresh orders.
**Alternatives:** `db push` (forbidden by PLAN §18); zod-only validation (rejected: DB must reject invalid rows written by future services); relative seed timestamps (rejected: non-reproducible).

## 2026-11-25 — Policy ingestion and Chroma contract

**Status:** accepted
**Decision:** Use the official `chromadb@3.5.0` JS client against the pinned `chromadb/chroma:1.5.9` container, always pass embeddings explicitly (`embeddingFunction: null`), and pin `embedding_model`, `embedding_dim`, `chunker_version`, and `hnsw:space=cosine` in collection metadata. The ingest compares chunk ids/content hashes, re-embeds only changed chunks, deletes stale ids, prunes removed sources, and asserts the env matches `EMBEDDING` in `models.config.ts`.
**Why:** Chroma's default embedding function would silently use a different model/dimension; metadata pinning makes a stale index fail loudly. Hash-based diffing makes `pnpm rag:ingest` idempotent and cheap (verified: first run 52 embedded, second run 0 embedded).
**Alternatives:** Chroma-side embedding (rejected: hidden model, wasted duplicate work); full re-index on every run (rejected: quota churn and unnecessary writes).

## 2026-11-25 — Orders REST is read-only in Phase 2

**Status:** accepted
**Decision:** Phase 2 ships `GET /orders` and `GET /orders/:id` only. Listing uses an opaque base64url keyset cursor (`createdAt|id`, newest first), a `status` filter, and includes `itemCount`; all queries are scoped by the authenticated user and another user's order returns **404**. Cancellation, checkout, idempotent placement, and the "AI assistant" badge move to Phase 6.
**Why:** Phase 2's gate is real data in the database and on the pages; cancel/checkout semantics depend on guardrails and the deterministic intent resolver built later. 404 avoids leaking order existence across users.
**Alternatives:** offset pagination (rejected: unstable under inserts); exposing `source`/`placedBy` badges now (rejected: plan defers agent-specific UI and the cancel flow).

## 2026-11-25 — Orders pages and date formatting

**Status:** accepted
**Decision:** `/orders` renders status filter tabs and a "Load more" cursor button; `/orders/:id` shows item snapshots, totals, the address snapshot, and cancellation dates but no cancel button yet. Dates are formatted with `Intl.DateTimeFormat` only in client components after fetch, so the browser locale/time zone applies.
**Why:** Matches the existing cart/product client-fetch pattern (401 → sign-in panel, skeleton while loading); formatting after hydration avoids SSR/client time-zone mismatches.
**Alternatives:** server-side rendering of orders (rejected: auth cookie forwarding and per-user caching complexity); relative timestamps (rejected: less precise for support/debugging).

## 2026-11-25 — Chroma readiness probe is separate and non-fatal

**Status:** accepted
**Decision:** Expose `GET /health/chroma` next to `GET /health` (DB). The probe is read-only: `getCollection` (never `getOrCreateCollection`), assert the pinned collection metadata, then `count()`. It always responds **200** with `{ status: 'ok' | 'unavailable', collection, chunkCount, latencyMs, error? }`, applies a 2 s `AbortSignal.timeout`, truncates provider errors to 200 chars, and returns no credentials. A failed probe is never cached or repaired.
**Why:** PLAN §15 requires `/health` for API + DB and a separate readiness check for Chroma; RAG must degrade gracefully while catalog/cart/orders keep working. Creating the collection during a health check would hide a broken index and mutate state from a GET.
**Alternatives:** include Chroma in `/health` (rejected: a vector-store outage would fail the API readiness gate); call Chroma's `heartbeat` only (rejected: proves the server is up, not that the index exists, matches env, and has chunks); auto-create the collection on a miss (rejected: repairs instead of reporting).

## 2026-11-25 — Hand-written migrations only (FTS5 drift)

**Status:** accepted
**Decision:** Do not run `prisma migrate dev` against this database. Author migration SQL by hand, review triggers/indexes/constraints, and apply with `prisma migrate deploy`; validate with `prisma migrate reset` and the in-memory `migrations.spec.ts`.
**Why:** `prisma migrate dev` treats the FTS5 shadow tables (`products_fts_*`) as drift and is interactive, so it cannot run non-interactively in this repo. Hand-written SQL keeps FTS5, triggers, and invariant checks in the same reviewed migration.
**Alternatives:** `db push`/`db pull` (forbidden by PLAN §18); excluding the FTS tables from drift detection (Prisma has no such switch for SQLite).

## 2026-11-25 — RAG retrieval tuning and distance semantics

**Status:** accepted
**Decision:** Retrieve `RAG_TOP_K=5` chunks from Chroma (`hnsw:space=cosine`) and keep only chunks with **cosine distance ≤ `RAG_MAX_DISTANCE=0.38`**. Both are env-overridable and zod-validated; defaults live in `guardrails.policy.ts`.
**Evidence (live `pnpm eval:rag`):** expected in-scope sections ranked #1–#2 at distances 0.185–0.333; the deliberately unrelated gift-wrapping question scored 0.410. A 0.38 cut keeps ~0.05 distance margin on both sides. Full eval: 10/10 hit-rate@5, 100% deterministic fact checks, 2/2 out-of-scope redirects, 1/1 no-match.
**Why:** Chroma returns a distance, not a similarity. Comparing it to a similarity threshold is the classic RAG bug; the gap between in-scope and unrelated questions is narrow enough that an arbitrary threshold would either answer from unrelated chunks or refuse valid policies.
**Alternatives:** a similarity transform (`1 - distance`) with a 0.6 threshold (equivalent, but easier to confuse); a model-side refusal only (rejected: an ungrounded match reaches the model); a larger top-k (rejected: more unrelated context for a small model).

## 2026-11-25 — Buffered SSE, session replay, and follow-up scope

**Status:** accepted
**Decision:** `/rag/chat` is a `POST` + raw `@Res()` SSE stream in **buffered** mode: generate → output guardrails → `Sources:` footer → persist assistant row → write `token` frames (48-char chunks) → `done`. Reuse `(sessionId, clientMessageId)` replays the stored assistant row; an unfinished/failed turn re-runs with the same ids under a per-session in-process lock (second concurrent turn → 409). A follow-up-shaped message in a session with history is treated as in-scope and condensed before retrieval; the classifier only runs for standalone ambiguous messages.
**Why:** PLAN §10 requires the full answer before output PII masking/format checks, and persisting before streaming makes a disconnect lossless. RAG is read-only, so a failed condense/classifier fails open; the distance threshold and no-match copy still prevent answering unrelated questions. The live smoke exposed that "What about returns?" was being redirected by the standalone scope heuristic, so follow-ups now bypass it.
**Alternatives:** true provider token streaming (rejected: cannot run output guardrails first); re-running a completed turn (rejected: duplicate model spend, duplicate persisted turn); trusting the classifier on every turn (rejected: extra latency/quota for obvious policy questions).

## 2026-11-25 — RAG eval gating and Unicode fact normalization

**Status:** accepted
**Decision:** `runRagEval` gates `allPassed` on retrieval alone when no answerer is supplied (`--retrieval-only`), and on hits + answers + facts for a full run. Fact checks normalize typographic hyphens/dashes (`U+2010–U+2015`, `U+2212`, soft hyphen), non-breaking spaces, and curly quotes to ASCII before matching; dataset facts accept singular/plural and hyphen variants (e.g. `30[\s-]*minute`).
**Why:** The retrieval-only runner previously exited 1 despite 10/10 hits, and correct answers such as `12‑month` (non-breaking hyphen) or `30‑minute window` failed deterministic checks. The eval must measure correctness, not typography.
**Alternatives:** loosen facts to bare numbers (rejected: loses the unit/deadline check); strip all punctuation (rejected: `$5.95` must stay intact); only run the full eval (rejected: retrieval regressions should be cheap to check without model spend).

## 2026-11-25 — Chroma verification without Docker

**Status:** accepted (environment note)
**Decision:** Final Phase 3 evidence was produced with a local `chromadb==1.5.9` server on `127.0.0.1:8000` because the Docker daemon was not available in the session. The pinned `chromadb/chroma:1.5.9` compose service, collection metadata, and client contract are unchanged.
**Why:** The RAG gate needs a real index; hiding the environment limitation would leave the calibration unverifiable. The server version matches the pinned image, and the index was rebuilt from `content/policies` with `pnpm rag:ingest` (52 chunks, 7 sources).
**Alternatives:** skip the live eval (rejected: the phase gate explicitly requires a reported hit rate); mock retrieval (rejected: would not validate distances or the real Chroma API).

## 2026-11-26 — Read-only agents: router confidence + deterministic fallbacks

**Status:** accepted
**Decision:** Build Phase 4 as a LangGraph `router` → one of `search` / `review` / `history` / `clarify`. The model route is accepted only at confidence ≥ `AGENT_ROUTER_MIN_CONFIDENCE` (default 0.55); otherwise a deterministic keyword/pattern heuristic chooses the route. If a specialist's model call fails or returns no tool call, code runs a deterministic fallback tool (`search_products`, `list_orders`, or `get_reviews` from `lastListedProducts`) and asks the model only to phrase the result.
**Why:** The phase gate requires search/review/history to work through `/assistant` without letting a small model invent products, IDs, or links. A code fallback keeps the feature usable when routing or tool-calling fails and preserves the rule that the LLM cannot bypass deterministic references.
**Alternatives:** trust every router decision (rejected: low-confidence guesses misroute); fail the turn on a missing tool call (rejected: a provider hiccup would break read-only search/history); let the model resolve "the second one" itself (rejected: ordinal references must resolve against server-held `lastListedProducts`).

## 2026-11-26 — Agent checkpointer and `agent_runs` audit

**Status:** accepted
**Decision:** Persist LangGraph checkpoints in a separate SQLite file (`CHECKPOINT_DATABASE_PATH`, default `./data/checkpoints.db`) with thread id `${userId}:${sessionId}`, and write one `agent_runs` row per turn containing route, model, provider, prompt version, tool-call JSON, status/error code, and duration. Model calls also record `token_usage`; guardrail actions write `guardrail_events`.
**Why:** PLAN §8/§15 requires per-turn agent auditing and bounded conversational state. Keeping checkpoints out of the application DB avoids mixing graph internals with domain tables, and the audit row makes routing/tool behavior inspectable after a live smoke or incident.
**Alternatives:** store checkpoints in the main DB (rejected: schema coupling and larger backups); log only to pino (rejected: not queryable per session/turn); skip prompt versions (rejected: cannot correlate quality with prompt changes).

## 2026-11-26 — Shared chat UI and safe chat links

**Status:** accepted
**Decision:** Use one generic `ChatPanel` for `/help` and `/assistant`, parameterized by endpoint kind, copy, examples, and source rendering. Assistant text is rendered as plain markdown with links filtered by `isSafeChatHref`; only `/products/:id`, `/cart`, `/orders/:id`, `/help`, `/assistant`, or `https:` links survive. `parseChatLinks` consumes balanced parentheses in markdown targets so an unsafe target is dropped whole.
**Why:** PLAN §10/§12 forbids agent-specific UI and unsafe model-authored links. A shared panel keeps the two chats consistent and avoids duplicating stream, history, Stop, and error handling. Balanced-parenthesis parsing prevents a partial URL (e.g. a trailing `)`) from slipping through the allowlist.
**Alternatives:** separate help/assistant components (rejected: duplicated lifecycle logic); render markdown HTML (rejected: XSS risk); allow all relative links (rejected: model could point at arbitrary app routes).

## 2026-11-26 — Cart agent: three tools, resolver-gated mutations

**Status:** accepted
**Decision:** Add a `cart` route with exactly three tools: `view_cart`, `add_to_cart`, and `update_cart_item`. All mutations call `CartService`, the same service used by `/cart` REST and UI. A deterministic resolver (`agent.cart.ts`) parses the user's own message for the action, product reference, and quantity before any write; the tool re-runs it and rejects model arguments that disagree with `NEEDS_CLARIFICATION` or `INTENT_UNRESOLVED`. Quantity is parsed after stripping ordinals ("the second one") and price phrases ("under $80"); non-committal language ("maybe", "I'm thinking about", "should I") never commits. The cart footer is server-generated from DB state (lines, qty, unit price, line total, subtotal, `/cart`). `cartFooter` is per-turn, while `lastCartSummary` persists in the checkpoint only after a cart tool. Router prompt bumped to `agent-router-v2`; cart prompt is `agent-cart-v1`.
**Why:** PLAN §8.5/§9.1 requires side effects to be authorized by code, not by the model, and chat/UI must share one cart implementation. Per-turn footer avoids re-showing a stale cart after a non-cart turn; persisting the summary supports follow-ups such as "remove the second one". Re-running the resolver inside the tool prevents a fabricated `productId` or `qty` from reaching `CartService`.
**Alternatives:** let the model call `CartService` directly (rejected: fabricated product/qty); trust the model's quantity (rejected: injection and ordinal ambiguity); build the footer in the prompt (rejected: hallucinated prices/links); store one persistent footer in graph state (rejected: stale cart shown on later turns).

## 2026-11-26 — Order write path: one mutex, one transaction, server-derived idempotency

**Status:** accepted
**Decision:** All order writes go through `OrderWriteService.placeOrder`: a process-wide `WriteMutex`, an idempotency read on `(userId, idempotencyKey)` before any cart load, then one Prisma interactive transaction that reprices from `products`, evaluates `order-limits.ts` deterministically, creates the order/items, conditionally decrements stock, and clears the cart. Keys are `cart:<clientRequestId>` (page) and `cart:<clientMessageId>` / `direct:<clientMessageId>` (chat); one order per chat turn is additionally enforced by `unique(user_id, turn_id)`. Cancellation is a guarded `updateMany` + restock in its own transaction and is idempotent for already-cancelled orders.
**Why:** PLAN §9.3–§9.6 requires no partial orders, no LLM call inside a transaction, and a retry that returns the original order even after the cart empties. A content hash would break that retry; a server-derived client id keeps it stable. Single-instance deployment makes the in-process mutex sufficient.
**Alternatives:** optimistic row locking alone (rejected: SQLite + single instance make a mutex simpler and testable); per-user mutexes (rejected: unnecessary complexity); trusting client-supplied idempotency keys verbatim (rejected: must be namespaced by user and operation kind).

## 2026-11-26 — Order agent: resolver-gated tools and server receipts

**Status:** accepted
**Decision:** The `order` route has exactly four tools (`quote_order`, `place_order`, `checkout_cart`, `cancel_order`). `agent.order.ts` resolves action/product/quantity/order reference from the user's own message plus structured state (`lastListedProducts`, `lastOrder`) before any mutation; each tool re-runs it and rejects model arguments that disagree. One order mutation is allowed per graph turn, after which the specialist loop stops and uses the server's deterministic wording. Order receipt footers are built from `OrderDetail` after output guardrails and carry items, quantities, unit prices, total, status, cancel deadline (server local time), and `/orders/:id`; history rows keep the compact list format. Router bumped to `agent-router-v3`, order prompt `agent-order-v1`.
**Why:** PLAN §8.5/§9 requires code — not the model — to authorize side effects, and prohibits raw review/product text from becoming a product or order reference. Stopping after one mutation prevents a model loop from attempting a second order in the same turn even before the DB constraint fires. Server-built receipts keep IDs, totals, and links out of model-authored prose.
**Alternatives:** let the model call `OrderWriteService` directly (rejected: fabricated ids/quantities); ask for confirmation before orders (rejected: PLAN §18 forbids confirmation UI/steps); render receipts in the prompt (rejected: hallucinated totals/links); trust the model to stop after one tool call (rejected: tool loops could repeat a mutation).

## 2026-11-26 — Deterministic-first jailbreak, opt-in live classifier

**Status:** accepted
**Decision:** `guardrails/jailbreak.ts` runs narrow regex rules on the current message on every turn. History and tool/retrieved text are scanned as untrusted data: they add reasons and a gray-zone score but cannot block a benign user by themselves; a bare compliance after an earlier injection does block. The small-model `guardrail` classifier only runs for gray-zone text when `JAILBREAK_LIVE_CLASSIFIER=true`; on failure, read-only chat is allowed and side-effect intent is blocked (policy fail mode).
**Why:** The eval gate (≤2% FPR, 0 false blocks on core benign flows) must be measurable offline in CI. A pure pre-filter is reproducible, cost-free, and still catches the cross-turn malicious-review scenario; the opt-in model adds coverage for novel attacks without making tests depend on keys.
**Alternatives:** live-only classifier (rejected: targets unmeasurable offline); regex-only with no upgrade path (rejected: PLAN §10.2 specifies a small-model classifier).

## 2026-11-26 — Redundancy short-circuit and receipt exemptions

**Status:** accepted
**Decision:** `guardrails/redundancy.ts` compares normalized-token Jaccard against recent assistant replies (≥0.9) and counts identical tool signatures (cap 2). Explicit re-requests and any cart/order tool on the turn are exempt. A hit returns short fixed copy before footer/persist; no regeneration.
**Why:** PLAN §10.2 requires a code-enforced short-circuit, but a naive similarity check would suppress legitimate receipts and "say that again" flows. Tool-derived receipts are built server-side, so exempting their turns loses no safety.
**Alternatives:** regenerate with a different prompt (rejected: extra quota and PLAN says do not regenerate); suppress all repeats (rejected: breaks explicit re-requests).

## 2026-11-26 — Offline eval harness over production functions

**Status:** accepted
**Decision:** `evals/guardrails/*.json` and `evals/agents/scenarios.json` feed Vitest-style runners that inject the real pure functions (`detectJailbreak`, `redactPii`, `detectRedundancy`, `evaluateOrder`, new `cart-limits.ts` helpers) and the real LangGraph with replay model steps. Cart qty/line/stock decisions were extracted from `CartService` into `cart-limits.ts` so the eval exercises production code; service behavior/messages are unchanged.
**Why:** PLAN §10.5 wants pass-rate tables in CI with no network or keys. Testing a copy of the rules would measure nothing; injecting the shipped functions makes the gate meaningful.
**Alternatives:** live-only evals (rejected: CI would need keys/Chroma); scenario-only agent tests with fakes for every layer (rejected: would not exercise routing/resolvers).

## 2026-11-26 — Demo artifacts and Nest DI boot fix

**Status:** accepted
**Decision:** Ship `docs/demo-script.md` (14 scenarios), `scripts/demo/smoke.mjs` (dependency-free HTTP smoke with PASS/FAIL/SKIP and `--db` for PII inspection), and `compose.demo.yml` (Chroma + API + web, single instance). Chat sessions are server-created: the smoke aliases a scenario label to the `message_start` session id and omits `sessionId` on the first turn. Also converted `OrderWriteService`/`CheckoutService` imports in `order.service.ts`, `checkout.service.ts` and `cart.controller.ts` from `import type` to value imports.
**Why:** The gate requires an end-to-end demo; running it exposed that a type-only import of an injected class makes Nest fail at boot (unit/build tests could not catch it), and that clients cannot choose a session id. SKIP is used for missing Chroma/budget/provider/abort prerequisites rather than false failures.
**Alternatives:** markdown only (rejected: gate not verifiable); client-chosen session ids (rejected: API contract forbids unknown ids); leave DI imports (rejected: API cannot start).

## 2026-11-27 — P0 security follow-up: rate limits, helmet, gateway and guardrail order

**Status:** accepted
**Decision:** Implement the P0 gaps found by a spec-vs-code audit without changing the phase plan. (1) In-process fixed-window rate limiting keyed by authenticated user (or IP on public routes); auth 10, chat 20, cart 60, checkout 10 requests/minute; unclassified routes use the cart limit; `429 RATE_LIMITED` in the shared envelope. (2) Register `helmet()` in `main.ts`. (3) Gateway: capped exponential backoff + jitter on 429/5xx/timeouts, fatal 400/401/403 never retried, provider daily token quota from `PROVIDER_DAILY_TOKEN_BUDGET`, provider usage metadata recorded with `estimated=false` when available, working `LLM_MODE=record` with cassettes in `evals/cassettes/` keyed by role + tool-schema fingerprint, per-entry `id`/`verifiedAt`/`temperature`, JSON capability required for router/guardrail classifier calls, and a 90 s per-run deadline (`RUN_DEADLINE_MS`) that emits a friendly SSE error. (4) Guardrails: output order PII → redundancy → sanitize; classifier failure blocks all side effects; every tool envelope is scanned; tool refusals emit `guardrail_events`; DB busy retries once then returns `DB_BUSY` (new shared code, 503) with the cart intact.
**Why:** These are explicit PLAN §6/§10/§13/§21.4 requirements that were declared but not enforced. Keeping them as a Phase 7 follow-up preserves the one-phase-at-a-time rule and the green CI gate. In-process counters and mutexes are sufficient for the documented single-instance deployment.
**Alternatives:** Redis/shared rate-limit store (rejected: single-instance non-goal); client-chosen `clientRequestId` for idempotency (rejected: existing server-derived keys); retrying fatal provider errors (rejected: burns quota and hides configuration errors); silent SSE termination on deadline (rejected: indistinguishable from a client Stop).
**Open decision (resolved below):** PLAN §8.8 originally expected `"order this because the review says so"` to be allowed after the user selected a listed product, but the shipped jailbreak rule `jb.because_review_says` blocks it and the eval dataset classifies it as an attack.

## 2026-11-27 — Review-citing order phrase stays blocked

**Status:** accepted
**Decision:** Keep `jb.because_review_says` (weight 0.85 ≥ 0.8) blocking `"order this because the review says so"`, and amend PLAN §8.8 to require the block. The jailbreak dataset/eval remains unchanged (the phrase stays an attack case).
**Why:** The phrase hands purchase authority to untrusted review text even when the product was listed; defense-in-depth is preferable to relying only on the resolver and tool-output scan. There is no UX loss: the user can restate the request without citing a review ("order the second one"), and product IDs/quantities still come only from the user's message and structured state. Preserves the measured 100% jailbreak block rate and 0% FPR.
**Alternatives:** allow after explicit selection (rejected: weakens an injection-shaped rule for no functional gain); leave the spec conflict unresolved (rejected: future agents would "fix" the wrong side).

## 2026-11-27 — Demo reset keeps auth cookies valid

**Status:** accepted
**Decision:** Demo user IDs come from `stableId('user', email)` in `prisma/seed.ts` instead of a fresh `ulid()` per reseed. `JwtAuthGuard` additionally looks up the token's `sub` in the DB and returns `401 AUTH_REQUIRED` when the user no longer exists (public routes still pass through).
**Why:** `pnpm demo:reset` deleted and reseeded users with new random IDs, so the browser's still-valid httpOnly JWT pointed at a nonexistent user. `/sessions` returned an empty list but `/rag/chat` (and any authenticated write) hit a foreign-key violation and the global filter surfaced it as `500 INTERNAL_ERROR — "Something went wrong. Please try again."`. Reproduced with a signed token for a deleted user; after the fix the same token gets a clean 401 and stable IDs are identical across a full migrate+seed on a throwaway DB.
**Alternatives:** manual re-login only (recurs after every reset); rotate `JWT_SECRET` on reset (needs env rewrites); keep random IDs and a generic 500 (rejected: poor demo UX and leaks no diagnostic value). The extra `findUnique` per authenticated request is acceptable in the documented single-instance deployment.

## 2026-11-27 — Policy help is anonymous-capable

**Status:** accepted (deviates from PLAN §21 "all routes except `/auth/*` require JWT"; PLAN amended)
**Decision:** `POST /rag/chat`, `GET /sessions?kind=rag` and `GET /sessions/:id/messages` are `@Public()` + `@AllowAnonymous()`. `AnonymousIdentityGuard` issues a signed httpOnly `guest_session` cookie (30 days) that maps each browser to its own synthetic User row, so existing session/message/guardrail/usage writes and ownership checks are unchanged. Signed-in users keep their identity; guest cookies are rejected by every other route. Guests are rate-limited by IP, not by their disposable user ID.
**Why:** The user reported that `/help` was unusable without signing in; store-policy answers are public information and should not require an account. A single shared guest account would let visitors read each other's questions (possible PII), so identity is per browser. User rows have an unusable argon2 hash and an `anonymous.invalid` email, so they cannot be used to log in.
**Alternatives:** require sign-in everywhere (rejected: prevents the intended public policy Q&A); skip persistence for anonymous turns (rejected: drops guardrail audit rows and history, and needs nullable FKs); client-generated guest id (rejected: forgeable). Guest rows accumulate one per browser; acceptable for the documented single-instance demo.

## 2026-11-27 — No visible sources in `/help` answers

**Status:** accepted (supersedes the `Sources:` footer part of the 2026-11-25 buffered-SSE decision; PLAN §7 amended)
**Decision:** `/rag/chat` streams and persists only the grounded answer. `buildSourcesFooter` is removed, the model prompt tells the answerer not to emit a `Sources` section, and the web transcript no longer renders `message.sources`. Deduplicated sources are still computed and stored in the assistant message's `metadata_json` for evals/audit.
**Why:** The user asked for the policy answer without the repeated source list. Removing both the server footer and the client metadata rendering avoids duplicate source displays; keeping metadata preserves grounding traceability with no schema change.
**Alternatives:** hide sources with CSS only (rejected: text still persisted/streamed); drop source metadata entirely (rejected: loses eval/audit data and needs contract changes).

## 2026-11-27 — `/help` composer is viewport-anchored

**Status:** accepted (extended to `/assistant` the same day)
**Decision:** `/help` and `/assistant` render a fixed chat surface under the sticky site header (`fixed inset-x-0 top-16 bottom-0`) whose inner column is `h-full`; `ChatPanel`'s `fixedComposer` mode keeps the transcript in `min-h-0 flex-1 overflow-y-auto` and the composer in `shrink-0` below it.
**Why:** The previous `h-full` root sat inside `<main class="flex-1">` in a `min-h-dvh` column body, so its height resolved to `auto`, the transcript never overflowed, and the composer ended up at the bottom of the message list — the page had to be scrolled to reach it. A viewport-height shell gives the transcript a definite height, so messages scroll in place and the composer stays at the bottom of the screen; `min-h-0` (instead of `min-h-[20rem]`) lets the transcript shrink on short viewports.
**Alternatives:** percentage height chain through `body`/`main` (rejected: needs global layout changes and would constrain every page); `position: sticky` composer (rejected: `scrollIntoView` does not reach through sticky boxes, so new answers would render behind it); `calc(100dvh - header - footer)` (rejected: hard-codes the footer's variable height). Trade-off: the fixed surface covers the site footer on both chat pages; the footer has no interactive content.
