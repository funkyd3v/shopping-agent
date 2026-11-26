/**
 * Read-only agent policy (PLAN §8). Limits, thresholds, and user-facing copy
 * live here; env overrides are validated in `config/env.ts` and applied in the
 * module factory.
 */
export type AgentPolicy = {
  /** Model calls per turn (router + specialist + one final summary). */
  maxModelCallsPerRun: number;
  /** Tool calls per turn; specialists also have a per-agent cap. */
  maxToolCallsPerRun: number;
  /** Bounded structured state (PLAN §8.2). */
  maxListedProducts: number;
  maxReplyChars: number;
  /** Redacted turns sent to router/specialists. */
  routerHistoryTurns: number;
  specialistHistoryTurns: number;
  /** Below this confidence, fall back to the deterministic heuristic. */
  routerMinConfidence: number;
  /** Search tool defaults and bounds. */
  searchLimit: number;
  maxSearchLimit: number;
  /** Fetch a wider pool when filtering by rating in code. */
  maxSearchPool: number;
  /** Review tool defaults and bounds. */
  reviewLimit: number;
  maxReviewLimit: number;
  /** Cap untrusted text before it reaches a model. */
  maxToolOutputChars: number;
  /** LangGraph recursion guard in addition to per-run limits. */
  recursionLimit: number;
  temperature: number;
  /** Rough prompt/tool reservation for the pre-flight budget check. */
  reservedPromptTokens: number;
};

/** Env-overridable subset applied by the module factory. */
export type AgentTuning = Pick<
  AgentPolicy,
  'maxModelCallsPerRun' | 'maxToolCallsPerRun' | 'routerMinConfidence'
>;

export const AGENT_POLICY: AgentPolicy = {
  /** Model calls per turn (router + specialist + one final summary). */
  maxModelCallsPerRun: 6,
  /** Tool calls per turn; specialists also have a per-agent cap. */
  maxToolCallsPerRun: 4,
  /** Bounded structured state (PLAN §8.2). */
  maxListedProducts: 10,
  maxReplyChars: 4_000,
  /** Redacted turns sent to router/specialists. */
  routerHistoryTurns: 6,
  specialistHistoryTurns: 6,
  /** Below this confidence, fall back to the deterministic heuristic. */
  routerMinConfidence: 0.55,
  /** Search tool defaults and bounds. */
  searchLimit: 5,
  maxSearchLimit: 10,
  /** Fetch a wider pool when filtering by rating in code. */
  maxSearchPool: 50,
  /** Review tool defaults and bounds. */
  reviewLimit: 5,
  maxReviewLimit: 10,
  /** Cap untrusted text before it reaches a model. */
  maxToolOutputChars: 6_000,
  /** LangGraph recursion guard in addition to per-run limits. */
  recursionLimit: 25,
  temperature: 0.2,
  /** Rough prompt/tool reservation for the pre-flight budget check. */
  reservedPromptTokens: 4_000,
};

export const AGENT_PROMPT_VERSIONS = {
  router: 'agent-router-v1',
  search: 'agent-search-v1',
  review: 'agent-review-v1',
  history: 'agent-history-v1',
  clarify: 'agent-clarify-v1',
} as const;

export const AGENT_COPY = {
  clarify:
    'I can help you find products, summarize customer reviews, or look up your orders. What would you like to do?',
  offTopic:
    'I can help with product search, customer reviews, and your order history. What would you like to look for?',
  cartNotAvailable:
    'Cart changes are not available in the assistant yet. You can view and update your cart on the Cart page (/cart).',
  orderNotAvailable:
    'Placing or cancelling orders is not available in the assistant yet. You can review your orders on the Orders page (/orders).',
  noProducts:
    'I could not find products matching that. Try a broader search or a different category.',
  noReviews: 'There are no customer reviews for that product yet.',
  noOrders: 'You do not have any orders yet.',
  productNotFound: 'I could not find that product.',
  orderNotFound: 'I could not find that order in your order history.',
  searchFallbackIntro: 'Here are the products that best match your request.',
  historyFallbackIntro: 'Here are your most recent orders.',
  productFallbackIntro: 'Here are the details for that product.',
  orderFallbackIntro: 'Here are the details for that order.',
  reviewClarify:
    "Which product would you like reviews for? Name it, or say 'the second one' after a product search.",
  reviewNoProducts:
    'Search for a product first, then ask me to summarize its reviews. You can also open a product page to read reviews.',
  reviewFallbackIntro: 'Here is a summary of the customer reviews.',
  providerError: "I couldn't complete that just now. Please try again.",
  budgetExhausted:
    "You've reached the chat usage limit for now. Please try again later. Products, your cart, and your orders are still available.",
  toolLimit: 'I reached the tool limit for this request. Please ask a narrower question.',
  stopped: 'Stopped.',
} as const;
