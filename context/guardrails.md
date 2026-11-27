# Guardrails

Rules are enforced in code; prompts are soft guidance. Guardrails block or modify; they never ask for confirmation.
Source: PLAN.md §10.

## Policy (single source of truth)

`apps/api/src/guardrails/guardrails.policy.ts`:

| Area | Values |
|---|---|
| Jailbreak | action `block`, threshold 0.8, scan tool outputs, include 4 history turns; fail mode: read-only allow, side effects block |
| PII | types email/phone/credit_card (Luhn); input `redact`, output `mask`; address `structured-only` |
| Redundancy | max 2 repeated tool calls; normalized-token Jaccard 0.9; `short_circuit`; exempt explicit-repeat/receipts |
| Tokens | per request 16k, per session 150k, per user daily 500k; count input+output; estimate when missing |
| Run limits | max 8 model calls, 6 tool calls, 2 internal model calls |
| Orders | max $200 total, 5 qty/item, 5 agent orders/day, $500 agent spend/day, 30-min cancel window, one order/turn, no partial orders |
| Cart | max 20 lines, 5 qty/item, checkout enforces order limits |
| Input | max 2000 message chars, 200 query chars, 10 items/tool |
| Topics | products, reviews, cart, orders, store policies |
| Blocked | reveal system prompt, access other users' data, ignore previous instructions |

Values are starting points; env overrides are zod-validated at startup. Provider quotas live in the model config/gateway.

## Middleware order

| # | Middleware | Hook | Behavior |
|---|---|---|---|
| 1 | `tokenBudget` | before agent | Check user/session/request budget + provider quota; friendly text if exhausted |
| 2 | `pii` (input) | before model | Redact email/phone/Luhn card before provider calls; keep raw for display |
| 3 | `jailbreak` | before agent | Regex pre-filter → small-model classifier (JSON risk/category/confidence, redacted history); block above threshold; classifier failure → allow read-only, block side effects |
| 4 | `runLimits` | around model/tool | Cap model/tool calls; graph wrapper if middleware unavailable; cap recursion |
| 5 | `toolOutputScan` | after tool | Scan tool results for injection/raw HTML/links; neutralize or replace with a neutral summary |
| 6 | `intentResolver` | around cart/order tools | Deterministic resolution + limits/ownership before side effects; refuse with explanation |
| 7 | `pii` (output) | after model, before streaming | Mask PII in buffered response and tool-derived text |
| 8 | `redundancy` | after model, before streaming | Detect repeated calls/near-duplicate replies; short-circuit |
| 9 | `outputFormat` | after model, before streaming | Strip raw HTML/unsafe schemes; validate known routes; minimal markdown |
| 10 | `usageRecorder` | after model | Persist `token_usage` from metadata or estimate |

**Why buffering:** output PII masking and redundancy need the full response. Generate → guard → footer → persist → stream.

**Implemented (Phase 7):**
- Jailbreak: `guardrails/jailbreak.ts` deterministic rules (override, leak, roleplay, encoded, indirect, privilege, multi-turn). Tool/history text is data: it can flag a turn but cannot block a benign user alone; compliance after an injection blocks. Opt-in `guardrail` chain via `JAILBREAK_LIVE_CLASSIFIER`; failure allows read-only, blocks side effects. Both services record `jailbreak`/`jailbreak.degraded`.
- Redundancy: `guardrails/redundancy.ts` normalized-token Jaccard ≥ `REDUNDANCY_SIMILARITY_THRESHOLD` or repeated tool calls beyond the cap; explicit repeats and receipts exempt; short-circuits before footer/persist.
- PII: identifier protection keeps SKU/`ORD-` digit runs out of phone/card regexes (no false positives on the eval set).
- Inspect: `pnpm guardrails:inspect [--rule --action --session --user --since --limit --json]` reads `guardrail_events` without raw text.

**Implemented (P0 follow-up, 2026-11-27):**
- Output order now matches §10.2: PII output mask → redundancy short-circuit → `sanitizeAnswer`; both `AgentService` and `RagService`.
- Jailbreak classifier failure now blocks **all** side-effect turns (`failMode.sideEffects='block'`), not just gray-zone ones; read-only chat still fails open.
- Tool-output scan covers every string in every tool envelope, not only reviews; only the model-facing `message` is rewritten (footers/structured state stay DB-derived).
- Resolver/tool refusals emit `agent.tool.<CODE>` `guardrail_events` rows and log lines.
- DB busy (`SQLITE_BUSY`/`P2028`/`P2034`) retries once under the write mutex, then returns structured `DB_BUSY` (503) with the cart unchanged (`order.db_busy` degrade event).
- The review-citing order phrase ("order this because the review says so") stays **blocked**; PLAN §8.8 was amended 2026-11-27 and the eval case stays an attack.

## Non-LLM safety rules

- Identity (`userId`, `sessionId`, `turnId`, `clientMessageId`) always comes from auth context.
- Tool outputs and retrieved text are untrusted data, never instructions.
- The order agent's context excludes raw review/product text.
- Server recomputes prices/totals; ignores model text amounts.
- Orders/checkouts only after the resolver returns a resolved intent from the user's message.
- Money is integer cents; totals server-side.
- Order/checkout writes use a mutex + short interactive transaction; no LLM inside.
- Markdown sanitized; links validated.
- Never send email/address/name to providers; never log raw PII; `guardrail_events.details_json` has rule IDs/scores, not raw text.
- FTS5 uses `Prisma.sql` binding and escaped tokens.
- Every block/redact/refusal writes `guardrail_events` + a log line.

## Fail modes

| Dependency fails | Read-only chat | Cart/order side effects |
|---|---|---|
| Jailbreak classifier | allow (log degraded) | block + friendly message |
| PII detector | allow (regex still runs) | allow (regex still runs) |
| Redundancy | allow | allow |
| Chroma | RAG "knowledge base unavailable" | unaffected |
| All LLM providers | friendly error | block |
| DB busy | retry once | retry once, then structured refusal (cart intact) |

## Evals

Datasets are JSON/JSONL; runners are Vitest suites (`pnpm eval:guardrails`), usable in replay and optionally live.

- `jailbreak`: ≥40 attacks + ≥40 benign; report block rate at ≤2% FPR.
- `pii`: emails/phones/cards (valid + invalid Luhn); ≥95% redaction, ≤2% false positives.
- `redundancy`: tool loops, repeated replies, explicit re-requests (not suppressed), receipts (exempt).
- `orders`: limit boundaries ($199.99/$200/$200.01), qty 5/6, daily cap, spend cap, replayed key, other user's order, cancel window, non-committal language, cross-turn injection, ambiguous references, no address.
- `cart`: add/update/remove/view, qty/line limits, out-of-stock add, checkout success/failure, double checkout, cart unchanged on failure, other user's cart.
- `rag`: hit-rate@k + deterministic fact checks; out-of-scope redirect; "I don't have that information".
- `agents`: 12–15 scenarios with expected tool calls and DB state.
- Runner prints a pass-rate table and writes JSON for CI.
- **Implemented:** `pnpm eval:guardrails` runs jailbreak (52 attacks / 49 benign), PII (25), redundancy (10), orders (15), cart (14) against the real pure functions; `pnpm eval:agents` runs 15 replay scenarios through the real graph. `pnpm eval:rag` stays live-only (Chroma + keys). Results in `evals/results/*.json` (gitignored).
- **Measured 2026-11-26:** jailbreak 100% block @ 0% FPR and 0 core false blocks; PII 100% redaction @ 0% FPR; redundancy/orders/cart 100%; agents 15/15. `pnpm demo:smoke` against replay API: 10 PASS / 0 FAIL / 4 SKIP (SKIP = Chroma/budget/provider/abort prerequisites).
