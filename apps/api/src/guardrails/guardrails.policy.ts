/**
 * Guardrail + RAG policy defaults (PLAN §7, §10). Thresholds and user-facing
 * copy live here, never as scattered literals. Env overrides are validated in
 * `config/env.ts` and applied at the call site.
 */
export const RAG_POLICY = {
  /** Retrieve this many chunks, then drop those above maxDistance. */
  topK: 5,
  /**
   * Cosine distance from Chroma (`hnsw:space=cosine`): 0 = identical,
   * 2 = opposite. Lower is better; this is NOT a similarity score.
   *
   * Calibrated with `pnpm eval:rag` on 2026-11-25: expected in-scope sections
   * scored 0.185–0.333, while the no-match question scored 0.410. 0.38 keeps a
   * clear gap and prevents unrelated policy chunks from reaching the model.
   */
  maxDistance: 0.38,
  /** Maximum source lines appended under an answer. */
  maxSources: 5,
  /** Redacted turns sent to the condense/scope models. */
  historyTurns: 6,
  /** Bound the Chroma query so a hung vector store cannot pin a request. */
  retrievalTimeoutMs: 5_000,
  /** Classifier must be at least this confident to redirect an ambiguous question. */
  scopeMinConfidence: 0.7,
  /** Only short/follow-up-shaped messages are condensed. */
  condenseMaxChars: 240,
  /** Maximum retrieved context characters sent to the answer model. */
  maxContextChars: 12_000,
  /** Rough prompt/context reservation for the pre-flight budget check. */
  reservedPromptTokens: 3_000,
  /** Hard cap on a sanitized answer before the sources footer. */
  maxAnswerChars: 6_000,
  /** Answer temperature for grounded RAG. */
  temperature: 0,
} as const;

export const RAG_COPY = {
  noMatch:
    "I don't have that information in the store policies. If you need help with a specific case, please contact support.",
  outOfScope:
    'I can only answer questions about store policies, such as shipping, returns, warranty, payments, privacy, and cancellations. For product recommendations, your cart, or your orders, please use the shopping assistant at /assistant.',
  unavailable:
    "The store knowledge base is temporarily unavailable, so I can't answer policy questions right now. Please try again in a moment. Products, your cart, and your orders are still available.",
  providerError: "I couldn't generate an answer just now. Please try again.",
  budgetExhausted:
    "You've reached the chat usage limit for now. Please try again later. Products, your cart, and your orders are still available.",
  stopped: 'Stopped.',
} as const;

export const RAG_PROMPT_VERSION = 'rag-policy-v1';

/**
 * Jailbreak defense (PLAN §10.2). A deterministic pre-filter runs on every
 * turn; the small-model `guardrail` classifier is opt-in (`--live` eval / env)
 * and only runs for text the pre-filter could not decide. Fail modes follow
 * the policy: a classifier outage allows read-only chat but blocks mutations.
 */
export const JAILBREAK_POLICY = {
  action: 'block',
  /** Heuristic/model score at or above this value blocks the turn. */
  threshold: 0.8,
  /** Score used to mark text as suspicious for the optional model classifier. */
  grayZone: 0.35,
  /** Scan tool-derived text as well as the user message. */
  scanToolOutputs: true,
  /** Redacted history turns fed to the classifier / multi-turn accumulator. */
  includeHistoryTurns: 4,
  failMode: { readOnly: 'allow', sideEffects: 'block' },
  /** Score assigned when the current turn complies with an earlier injection. */
  complianceBoost: 0.9,
} as const;

/** Near-duplicate/short-circuit rules (PLAN §10.2, §10.5). */
export const REDUNDANCY_POLICY = {
  /** Repeated identical tool calls beyond this count are a loop. */
  maxRepeatedToolCalls: 2,
  /** Normalized-token Jaccard at or above this value is a duplicate reply. */
  similarityThreshold: 0.9,
  /** Ignore short acknowledgements; only compare substantive replies. */
  minReplyChars: 80,
  action: 'short_circuit',
  /** These must never be suppressed. */
  exempt: ['explicit-repeat', 'order-receipt', 'cart-receipt'],
  /** Assistant turns compared with the current reply. */
  historyTurns: 4,
} as const;

export const GUARDRAIL_COPY = {
  jailbreakBlocked:
    "I can't help with that request. I can help you find products, manage your cart, place orders, and answer store-policy questions.",
  redundancy:
    'I already answered that. Ask for something new, or say "again" if you want me to repeat it.',
} as const;

/** Prompt for the optional ambiguity classifier (JSON output). */
export const SCOPE_CLASSIFIER_SYSTEM_PROMPT = `You classify questions for a store-policy help desk.
Allowed topics: shipping, delivery, returns, refunds, warranty, payment methods, privacy, order cancellation policy, and store FAQ.
Not allowed: product recommendations or searches, product prices/stock, the user's cart, placing/checking/cancelling specific orders, or anything unrelated to store policies.
Return ONLY compact JSON: {"inScope":true|false,"confidence":0.0-1.0}.`;
