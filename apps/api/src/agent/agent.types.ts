import type { GatewayToolCall } from '../model-gateway/model-gateway.service';

/** Routes the router may choose (PLAN §8.1/§8.3). */
export const AGENT_ROUTES = ['search', 'review', 'cart', 'order', 'history', 'clarify'] as const;
export type AgentRoute = (typeof AGENT_ROUTES)[number];

/** Phase 5 implements cart; the order node arrives in Phase 6. */
export type ImplementedAgent = 'search' | 'review' | 'cart' | 'history' | 'clarify';

export type RouteSource = 'model' | 'heuristic' | 'fallback';

export type HistoryTurn = { role: 'user' | 'assistant'; content: string };

/** Structured state only: never raw reviews, descriptions, or policy text. */
export type ListedProduct = {
  id: string;
  name: string;
  priceCents: number;
  ratingAvg: number;
  ratingCount: number;
  position: number;
  /** Used only for deterministic SKU references; never free text. */
  sku?: string;
};

export type LastCartSummary = {
  items: Array<{ productId: string; name: string; qty: number; unitPriceCents: number }>;
  subtotalCents: number;
} | null;

export type LastOrder = {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
} | null;

/** Audit-safe tool call summary (no raw arguments or PII). */
export type ToolCallRecord = {
  name: string;
  ok: boolean;
  errorCode?: string;
};

export type ProductFooterItem = {
  id: string;
  name: string;
  priceCents: number;
  ratingAvg: number;
  ratingCount: number;
};

export type OrderFooterItem = {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  currency: string;
};

/** Full LangGraph state, checkpointed per `${userId}:${sessionId}`. */
export type AgentGraphState = {
  userId: string;
  sessionId: string;
  turnId: string;
  clientMessageId: string;
  /** Redacted current user message. */
  message: string;
  recentMessages: HistoryTurn[];
  lastListedProducts: ListedProduct[];
  lastCartSummary: LastCartSummary;
  lastOrder: LastOrder;
  sessionRiskScore: number;
  route: AgentRoute;
  routeConfidence: number;
  routeReason: string;
  routeSource: RouteSource;
  reply: string;
  toolCalls: ToolCallRecord[];
  productFooter: ProductFooterItem[];
  orderFooter: OrderFooterItem[];
  /** Cart state for this turn's footer; reset per turn, unlike `lastCartSummary`. */
  cartFooter: LastCartSummary;
  flaggedToolOutputs: number;
  model: string;
  provider: string;
  promptVersion: string;
};

/** Per-turn input; previous `lastListedProducts`/`lastOrder` survive in the checkpoint. */
export type AgentGraphInput = Pick<
  AgentGraphState,
  | 'userId'
  | 'sessionId'
  | 'turnId'
  | 'clientMessageId'
  | 'message'
  | 'recentMessages'
  | 'route'
  | 'routeConfidence'
  | 'routeReason'
  | 'routeSource'
  | 'reply'
  | 'toolCalls'
  | 'productFooter'
  | 'orderFooter'
  | 'cartFooter'
  | 'flaggedToolOutputs'
  | 'model'
  | 'provider'
  | 'promptVersion'
>;

export type AgentGraphOutput = AgentGraphState;

/** The model-call surface injected into the graph (testable without providers). */
export type AgentModelCall = (input: {
  chain: 'router' | 'agent';
  messages: import('../model-gateway/model-gateway.service').ChatMessage[];
  tools?: import('../model-gateway/model-gateway.service').ToolSpec[];
  temperature: number;
}) => Promise<{
  content: string;
  toolCalls: GatewayToolCall[];
  provider: string;
  model: string;
}>;
