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

/** Prompt for the optional ambiguity classifier (JSON output). */
export const SCOPE_CLASSIFIER_SYSTEM_PROMPT = `You classify questions for a store-policy help desk.
Allowed topics: shipping, delivery, returns, refunds, warranty, payment methods, privacy, order cancellation policy, and store FAQ.
Not allowed: product recommendations or searches, product prices/stock, the user's cart, placing/checking/cancelling specific orders, or anything unrelated to store policies.
Return ONLY compact JSON: {"inScope":true|false,"confidence":0.0-1.0}.`;
