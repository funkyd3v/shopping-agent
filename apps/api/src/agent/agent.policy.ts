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
  /** Redacted recent messages (not turns) sent to the router/specialists. */
  routerHistoryMessages: number;
  specialistHistoryMessages: number;
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
  /** Redacted recent messages (not turns) sent to the router/specialists. */
  routerHistoryMessages: 12,
  specialistHistoryMessages: 12,
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
  router: 'agent-router-v3',
  search: 'agent-search-v2',
  review: 'agent-review-v2',
  cart: 'agent-cart-v1',
  order: 'agent-order-v1',
  history: 'agent-history-v1',
  clarify: 'agent-clarify-v1',
} as const;

export const AGENT_COPY = {
  clarify:
    'I can help you find products, summarize customer reviews, or look up your orders. What would you like to do?',
  offTopic:
    'I can help with product search, customer reviews, and your order history. What would you like to look for?',
  cartClarify:
    'I can show your cart, add a product to it, or change a quantity. What would you like to do?',
  cartWhichProduct:
    'Which product would you like to add? Search for a product first, then say something like "add the second one to my cart".',
  cartAmbiguous:
    'I found more than one match. Which product do you mean? Name it, or say its position in the list.',
  cartQtyClarify: 'How many would you like? You can add between 1 and 5 of an item.',
  cartQtyLimit: 'You can have up to 5 of each item in your cart. Try a quantity of 5 or fewer.',
  cartNonCommittal:
    'I have not changed your cart. If you want to add or update something, say so directly.',
  cartClearUnsupported:
    'I can remove items one at a time. Which item should I remove from your cart?',
  cartEmpty: 'Your cart is empty.',
  cartFallbackIntro: 'Here is your cart.',
  cartFallback: 'Here is your updated cart.',
  cartIntentUnresolved:
    'I did not change your cart because the request did not match a product and quantity in your message. Please name the product and quantity.',
  orderClarify:
    'I can place an order, check out your cart, quote a price, or cancel an order. Which would you like?',
  orderWhichProduct:
    'Which product would you like to order? Search for one first, then say something like "order 2 of the second one".',
  orderAmbiguous:
    'I found more than one match. Which product do you mean? Name it, or say its position in the list.',
  orderQtyLimit: 'You can order between 1 and 5 of an item. How many would you like?',
  orderNonCommittal:
    'I have not placed an order. If you want to order something, say so directly — for example "order 2 of the first one".',
  orderCancelWhich:
    'Which order should I cancel? Use its order number (ORD-…), or say "cancel my last order".',
  orderCheckoutClarify:
    'Should I check out your cart, or place a direct order for that product? Please say which one.',
  orderPlacedIntro: 'Done — your order was placed.',
  orderCheckoutIntro: 'Done — your cart was checked out into an order.',
  orderCancelledIntro: 'Done — that order was cancelled and the items were restocked.',
  orderIntentUnresolved:
    'I did not place an order because the request did not match a product, quantity, or order in your message.',
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
