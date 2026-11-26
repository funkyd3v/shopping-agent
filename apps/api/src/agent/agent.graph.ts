import { Annotation, type BaseCheckpointSaver, END, START, StateGraph } from '@langchain/langgraph';
import { isTurnAborted } from '../common/turn-abort';
import type { ChatMessage } from '../model-gateway/model-gateway.service';
import { AGENT_COPY, AGENT_POLICY, AGENT_PROMPT_VERSIONS, type AgentPolicy } from './agent.policy';
import {
  buildSpecialistContext,
  HISTORY_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  SEARCH_SYSTEM_PROMPT,
} from './agent.prompts';
import { parseSearchFallback, resolveProductReference } from './agent.refs';
import { buildRouterMessages, heuristicRoute, parseRouterDecision } from './agent.router';
import type { AgentToolRegistry, ToolContext, ToolExecution } from './agent.tools';
import type {
  AgentGraphInput,
  AgentGraphOutput,
  AgentGraphState,
  AgentModelCall,
  AgentRoute,
  ImplementedAgent,
  LastOrder,
  ListedProduct,
  OrderFooterItem,
  ProductFooterItem,
  ToolCallRecord,
} from './agent.types';

/**
 * LangGraph read-only agent (PLAN §8.1–§8.8): router → one specialist →
 * output. Specialists are small tool-calling loops with hard caps; code (not
 * the model) decides fallbacks, product references, and footers.
 */

const AgentState = Annotation.Root({
  userId: Annotation<string>,
  sessionId: Annotation<string>,
  turnId: Annotation<string>,
  clientMessageId: Annotation<string>,
  message: Annotation<string>,
  recentMessages: Annotation<AgentGraphState['recentMessages']>,
  lastListedProducts: Annotation<ListedProduct[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  lastCartSummary: Annotation<AgentGraphState['lastCartSummary']>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  lastOrder: Annotation<LastOrder | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  sessionRiskScore: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  route: Annotation<AgentRoute>,
  routeConfidence: Annotation<number>,
  routeReason: Annotation<string>,
  routeSource: Annotation<AgentGraphState['routeSource']>,
  reply: Annotation<string>,
  toolCalls: Annotation<ToolCallRecord[]>,
  productFooter: Annotation<ProductFooterItem[]>,
  orderFooter: Annotation<OrderFooterItem[]>,
  flaggedToolOutputs: Annotation<number>,
  model: Annotation<string>,
  provider: Annotation<string>,
  promptVersion: Annotation<string>,
});

type State = typeof AgentState.State;

export type AgentGraphDeps = {
  modelCall: AgentModelCall;
  tools: Pick<AgentToolRegistry, 'specsFor' | 'execute'>;
  /** Resolved policy (env overrides applied by the service). */
  policy?: AgentPolicy;
};

export type AgentGraphOptions = {
  checkpointer?: BaseCheckpointSaver;
  signal?: AbortSignal;
};

/** Build the compiled graph. Cheap enough to construct per turn. */
export function createAgentGraph(deps: AgentGraphDeps, checkpointer?: BaseCheckpointSaver) {
  const builder = new StateGraph(AgentState)
    .addNode('router', (state) => routeNode(state, deps))
    .addNode('search', (state) => specialistNode('search', state, deps))
    .addNode('review', (state) => specialistNode('review', state, deps))
    .addNode('history', (state) => specialistNode('history', state, deps))
    .addNode('clarify', (state) => clarifyNode(state))
    .addEdge(START, 'router')
    .addConditionalEdges(
      'router',
      (state): ImplementedAgent =>
        state.route === 'cart' || state.route === 'order' ? 'clarify' : state.route,
      { search: 'search', review: 'review', history: 'history', clarify: 'clarify' },
    )
    .addEdge('search', END)
    .addEdge('review', END)
    .addEdge('history', END)
    .addEdge('clarify', END);

  return checkpointer ? builder.compile({ checkpointer }) : builder.compile();
}

/** Invoke one turn for `${userId}:${sessionId}`. */
export async function runAgentGraph(
  input: AgentGraphInput,
  deps: AgentGraphDeps,
  options: AgentGraphOptions = {},
): Promise<AgentGraphOutput> {
  const graph = createAgentGraph(deps, options.checkpointer);
  const policy = deps.policy ?? AGENT_POLICY;
  const result = await graph.invoke(input, {
    configurable: { thread_id: threadKey(input.userId, input.sessionId) },
    recursionLimit: policy.recursionLimit,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return result as AgentGraphOutput;
}

export function threadKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

// ── router ──────────────────────────────────────────────────────────────────

async function routeNode(state: State, deps: AgentGraphDeps): Promise<Partial<State>> {
  const policy = deps.policy ?? AGENT_POLICY;
  let model = state.model;
  let provider = state.provider;
  let decision: ReturnType<typeof parseRouterDecision> = null;

  try {
    const result = await deps.modelCall({
      chain: 'router',
      messages: buildRouterMessages(state),
      temperature: 0,
    });
    model = result.model;
    provider = result.provider;
    decision = parseRouterDecision(result.content);
  } catch (error) {
    if (isTurnAborted(error)) throw error;
  }

  const heuristic = heuristicRoute(state.message);
  if (decision && decision.confidence >= policy.routerMinConfidence) {
    return {
      route: decision.agent,
      routeConfidence: decision.confidence,
      routeReason: decision.reason || 'model route',
      routeSource: 'model',
      model,
      provider,
      promptVersion: AGENT_PROMPT_VERSIONS.router,
    };
  }

  return {
    route: heuristic.agent,
    routeConfidence: heuristic.confidence,
    routeReason: decision ? `low confidence: ${decision.reason || 'model'}` : heuristic.reason,
    routeSource: decision ? 'fallback' : 'heuristic',
    model,
    provider,
    promptVersion: AGENT_PROMPT_VERSIONS.router,
  };
}

// ── clarify ─────────────────────────────────────────────────────────────────

function clarifyNode(state: State): Partial<State> {
  const reply =
    state.route === 'cart'
      ? AGENT_COPY.cartNotAvailable
      : state.route === 'order'
        ? AGENT_COPY.orderNotAvailable
        : state.routeSource === 'heuristic' && state.routeConfidence <= 0.5
          ? AGENT_COPY.offTopic
          : AGENT_COPY.clarify;

  return {
    reply,
    toolCalls: [],
    productFooter: [],
    orderFooter: [],
    flaggedToolOutputs: 0,
    promptVersion: AGENT_PROMPT_VERSIONS.clarify,
  };
}

// ── specialists ─────────────────────────────────────────────────────────────

type ToolAccumulator = {
  records: ToolCallRecord[];
  products: ProductFooterItem[];
  orders: OrderFooterItem[];
  lastListedProducts?: ListedProduct[];
  lastOrder?: LastOrder;
  flagged: number;
  reviewCount: number;
  fallbackText: string;
};

function emptyAccumulator(): ToolAccumulator {
  return {
    records: [],
    products: [],
    orders: [],
    flagged: 0,
    reviewCount: 0,
    fallbackText: '',
  };
}

async function specialistNode(
  agent: ImplementedAgent,
  state: State,
  deps: AgentGraphDeps,
): Promise<Partial<State>> {
  const policy = deps.policy ?? AGENT_POLICY;
  const specs = deps.tools.specsFor(agent);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(agent) },
    { role: 'user', content: buildSpecialistUserMessage(state, policy) },
  ];
  const accumulator = emptyAccumulator();
  const context = {
    userId: state.userId,
    sessionId: state.sessionId,
    turnId: state.turnId,
    message: state.message,
    lastListedProducts: state.lastListedProducts,
  };

  let model = state.model;
  let provider = state.provider;
  let modelCalls = 0;
  let toolCalls = 0;
  let executedTool = false;
  let modelFailed = false;
  let reply = '';

  while (modelCalls < policy.maxModelCallsPerRun) {
    let result: Awaited<ReturnType<AgentModelCall>>;
    try {
      result = await deps.modelCall({
        chain: 'agent',
        messages,
        tools: specs,
        temperature: policy.temperature,
      });
    } catch (error) {
      if (isTurnAborted(error)) throw error;
      modelFailed = true;
      break;
    }
    modelCalls += 1;
    model = result.model;
    provider = result.provider;

    if (result.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: result.content,
        toolCalls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        const allowed = specs.some((spec) => spec.name === call.name);
        if (!allowed) {
          accumulator.records.push({ name: call.name, ok: false, errorCode: 'UNKNOWN_TOOL' });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: toolError('UNKNOWN_TOOL', 'That tool is not available for this request.'),
          });
          continue;
        }
        if (toolCalls >= policy.maxToolCallsPerRun) {
          accumulator.records.push({ name: call.name, ok: false, errorCode: 'TOOL_LIMIT' });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: toolError('TOOL_LIMIT', AGENT_COPY.toolLimit),
          });
          continue;
        }

        const execution = await deps.tools.execute(call.name, call.args, context);
        toolCalls += 1;
        executedTool = true;
        mergeExecution(accumulator, execution, policy);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: execution.message,
        });
      }
      continue;
    }

    reply = result.content.trim();
    break;
  }

  // The model answered without a tool (or failed): ground the answer in code.
  if (!executedTool) {
    const fallback = await deterministicFallback(agent, state, deps, context, policy);
    if ('terminal' in fallback) {
      return finish(agent, accumulator, fallback.terminal, model, provider);
    }
    executedTool = true;
    mergeExecution(accumulator, fallback.execution, policy);
    messages.push({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'fallback_1', name: fallback.name, args: fallback.args }],
    });
    messages.push({
      role: 'tool',
      toolCallId: 'fallback_1',
      name: fallback.name,
      content: fallback.execution.message,
    });
    messages.push({
      role: 'user',
      content:
        'Using only the tool result above, answer the customer in plain text. Do not invent facts, ids, or links.',
    });

    if (!modelFailed && modelCalls < policy.maxModelCallsPerRun) {
      try {
        const summary = await deps.modelCall({
          chain: 'agent',
          messages,
          temperature: policy.temperature,
        });
        model = summary.model;
        provider = summary.provider;
        reply = summary.content.trim();
      } catch (error) {
        if (isTurnAborted(error)) throw error;
      }
    }
  }

  if (reply.length === 0) {
    reply = accumulator.fallbackText || defaultReply(agent, accumulator);
  }
  if (accumulator.reviewCount === 0 && agent === 'review' && reply.length === 0) {
    reply = AGENT_COPY.noReviews;
  }

  return finish(agent, accumulator, reply, model, provider);
}

function finish(
  agent: ImplementedAgent,
  accumulator: ToolAccumulator,
  reply: string,
  model: string,
  provider: string,
): Partial<State> {
  return {
    reply,
    toolCalls: accumulator.records,
    productFooter: accumulator.products,
    orderFooter: accumulator.orders,
    flaggedToolOutputs: accumulator.flagged,
    model,
    provider,
    promptVersion: AGENT_PROMPT_VERSIONS[agent],
    ...(accumulator.lastListedProducts
      ? { lastListedProducts: accumulator.lastListedProducts }
      : {}),
    ...(accumulator.lastOrder ? { lastOrder: accumulator.lastOrder } : {}),
  };
}

// ── deterministic fallback ──────────────────────────────────────────────────

type FallbackOutcome =
  | { terminal: string }
  | { execution: ToolExecution; name: string; args: Record<string, unknown> };

async function deterministicFallback(
  agent: ImplementedAgent,
  state: State,
  deps: AgentGraphDeps,
  context: ToolContext,
  policy: AgentPolicy,
): Promise<FallbackOutcome> {
  if (agent === 'search') {
    const args = parseSearchFallback(state.message);
    return {
      name: 'search_products',
      args,
      execution: await deps.tools.execute('search_products', args, context),
    };
  }

  if (agent === 'history') {
    const args = { limit: 5 };
    return {
      name: 'list_orders',
      args,
      execution: await deps.tools.execute('list_orders', args, context),
    };
  }

  const reference = resolveProductReference(state.message, state.lastListedProducts);
  if (!reference) {
    return {
      terminal:
        state.lastListedProducts.length === 0
          ? AGENT_COPY.reviewNoProducts
          : AGENT_COPY.reviewClarify,
    };
  }
  if ('ambiguous' in reference) return { terminal: AGENT_COPY.reviewClarify };

  const args = { productId: reference.product.id, limit: policy.reviewLimit };
  return {
    name: 'get_reviews',
    args,
    execution: await deps.tools.execute('get_reviews', args, context),
  };
}

function defaultReply(agent: ImplementedAgent, accumulator: ToolAccumulator): string {
  if (agent === 'search') {
    return accumulator.products.length === 0
      ? AGENT_COPY.noProducts
      : AGENT_COPY.searchFallbackIntro;
  }
  if (agent === 'history') {
    return accumulator.orders.length === 0 ? AGENT_COPY.noOrders : AGENT_COPY.historyFallbackIntro;
  }
  return accumulator.reviewCount === 0 ? AGENT_COPY.noReviews : AGENT_COPY.reviewFallbackIntro;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function mergeExecution(
  accumulator: ToolAccumulator,
  execution: ToolExecution,
  policy: AgentPolicy,
): void {
  accumulator.records.push(execution.record);
  accumulator.flagged += execution.flagged ?? 0;
  if (execution.reviewCount !== undefined) accumulator.reviewCount = execution.reviewCount;
  if (execution.fallbackText) accumulator.fallbackText = execution.fallbackText;
  if (execution.lastListedProducts) {
    accumulator.lastListedProducts = execution.lastListedProducts.slice(
      0,
      policy.maxListedProducts,
    );
  }
  if (execution.lastOrder) accumulator.lastOrder = execution.lastOrder;
  if (execution.products) {
    accumulator.products = mergeById(
      accumulator.products,
      execution.products,
      policy.maxListedProducts,
    );
  }
  if (execution.orders) {
    accumulator.orders = mergeById(accumulator.orders, execution.orders, policy.maxListedProducts);
  }
}

function mergeById<T extends { id: string }>(current: T[], next: T[], limit: number): T[] {
  const seen = new Set(current.map((item) => item.id));
  const merged = [...current];
  for (const item of next) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return merged;
}

function systemPrompt(agent: ImplementedAgent): string {
  if (agent === 'search') return SEARCH_SYSTEM_PROMPT;
  if (agent === 'review') return REVIEW_SYSTEM_PROMPT;
  return HISTORY_SYSTEM_PROMPT;
}

function buildSpecialistUserMessage(state: State, policy: AgentPolicy): string {
  const history = state.recentMessages
    .slice(-policy.specialistHistoryTurns)
    .map(
      (turn) =>
        `${turn.role === 'user' ? 'Customer' : 'Assistant'}: ${turn.content
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 400)}`,
    )
    .join('\n');

  return `${buildSpecialistContext(state)}

Recent conversation (redacted):
${history.length > 0 ? history : '(none)'}

Customer message: ${state.message}`;
}

function toolError(code: string, message: string): string {
  return JSON.stringify({ trust: 'untrusted', source: 'tool', data: { error: { code, message } } });
}
