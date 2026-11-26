import { z } from 'zod';
import { type AgentGraphDeps, runAgentGraph } from '../agent/agent.graph';
import { AGENT_COPY } from '../agent/agent.policy';
import type { ToolExecution } from '../agent/agent.tools';
import type { AgentGraphInput, AgentModelCall, ListedProduct } from '../agent/agent.types';
import { detectJailbreak } from '../guardrails/jailbreak';
import type { EvalResult } from './guardrails.eval';

/** Agent scenarios (PLAN §10.5): route, tool calls, and side-effect state. */
export const agentScenarioSchema = z.object({
  id: z.string(),
  message: z.string(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .optional(),
  listed: z
    .array(z.object({ position: z.number(), id: z.string(), name: z.string().optional() }))
    .default([]),
  expect: z.object({
    route: z.enum(['search', 'review', 'cart', 'order', 'history', 'clarify']).optional(),
    tools: z.array(z.string()).default([]),
    blocked: z.boolean().default(false),
    noOrder: z.boolean().default(false),
  }),
});

export const agentDatasetSchema = z.object({
  version: z.literal(1),
  scenarios: z.array(agentScenarioSchema).min(12),
});

export type AgentScenario = z.infer<typeof agentScenarioSchema>;
export type AgentDataset = z.infer<typeof agentDatasetSchema>;

export type AgentEvalDeps = {
  /** Deterministic replay steps: router JSON, tool call, final reply. */
  modelCallFor: (scenario: AgentScenario) => AgentModelCall;
  tools?: (scenario: AgentScenario) => AgentGraphDeps['tools'];
};

const MUTATIONS = new Set(['place_order', 'checkout_cart', 'cancel_order']);
const SPECS: Record<string, string[]> = {
  search: ['search_products', 'get_product'],
  review: ['get_reviews'],
  cart: ['view_cart', 'add_to_cart', 'update_cart_item'],
  order: ['quote_order', 'place_order', 'checkout_cart', 'cancel_order'],
  history: ['list_orders', 'get_order'],
  clarify: [],
};

function listedProducts(scenario: AgentScenario): ListedProduct[] {
  return scenario.listed.map((item) => ({
    id: item.id,
    name: item.name ?? `Product ${item.position}`,
    priceCents: 1_000,
    ratingAvg: 4.5,
    ratingCount: 10,
    position: item.position,
  }));
}

function inputFor(scenario: AgentScenario): AgentGraphInput {
  return {
    userId: 'user_eval',
    sessionId: `session_${scenario.id}`,
    turnId: `turn_${scenario.id}`,
    clientMessageId: `eval-${scenario.id}`,
    message: scenario.message,
    recentMessages: scenario.history ?? [],
    route: 'clarify',
    routeConfidence: 0,
    routeReason: '',
    routeSource: 'fallback',
    reply: '',
    toolCalls: [],
    productFooter: [],
    orderFooter: [],
    cartFooter: null,
    flaggedToolOutputs: 0,
    model: '',
    provider: '',
    promptVersion: '',
    lastListedProducts: listedProducts(scenario),
  };
}

/** Default replay tool registry: records calls and returns safe envelopes. */
function defaultTools(scenario: AgentScenario, executed: string[]): AgentGraphDeps['tools'] {
  const products = listedProducts(scenario);
  const execution = (name: string): ToolExecution => {
    const base: ToolExecution = {
      record: { name, ok: true },
      message: JSON.stringify({ trust: 'untrusted', source: 'eval', data: {} }),
      fallbackText: AGENT_COPY.searchFallbackIntro,
    };
    if (name === 'search_products' || name === 'get_product') {
      return {
        ...base,
        lastListedProducts: products,
        products: products.map(({ position: _position, ...rest }) => rest),
      };
    }
    if (name === 'get_reviews')
      return { ...base, reviewCount: 3, fallbackText: AGENT_COPY.reviewFallbackIntro };
    if (name === 'view_cart' || name === 'add_to_cart' || name === 'update_cart_item') {
      return {
        ...base,
        cartSummary: {
          items: [{ productId: 'prod_1', name: 'Product 1', qty: 1, unitPriceCents: 1_000 }],
          subtotalCents: 1_000,
        },
        fallbackText: AGENT_COPY.cartFallbackIntro,
      };
    }
    if (MUTATIONS.has(name) || name === 'quote_order') {
      return {
        ...base,
        orders: [
          {
            id: 'ord_eval',
            orderNumber: 'ORD-EVAL1',
            status: 'placed',
            totalCents: 1_000,
            currency: 'USD',
            receipt: true,
          },
        ],
        lastOrder: {
          id: 'ord_eval',
          orderNumber: 'ORD-EVAL1',
          status: 'placed',
          totalCents: 1_000,
        },
        fallbackText: AGENT_COPY.orderPlacedIntro,
      };
    }
    return base;
  };
  return {
    specsFor: (agent) =>
      (SPECS[agent] ?? []).map((name) => ({ name, description: '', schema: {} as never })),
    execute: async (name: string) => {
      executed.push(name);
      return execution(name);
    },
  };
}

/** Default replay harness: deterministic router/tool/final-reply steps. */
export function replayModelCall(scenario: AgentScenario): AgentModelCall {
  const steps = scenario.expect.blocked
    ? []
    : [
        {
          content: JSON.stringify({
            agent: scenario.expect.route ?? 'clarify',
            confidence: 0.95,
            reason: 'replay eval',
          }),
          toolCalls: [],
          provider: 'replay',
          model: 'replay',
        },
        {
          content: '',
          toolCalls: scenario.expect.tools[0]
            ? [{ id: 'call_1', name: scenario.expect.tools[0], args: {} }]
            : [],
          provider: 'replay',
          model: 'replay',
        },
        {
          content: 'Here is what I found.',
          toolCalls: [],
          provider: 'replay',
          model: 'replay',
        },
      ];
  let index = 0;
  return async () => {
    const step = steps[index++];
    return step ?? { content: '', toolCalls: [], provider: 'replay', model: 'replay' };
  };
}

export async function runAgentEval(
  dataset: AgentDataset,
  deps: AgentEvalDeps,
): Promise<EvalResult> {
  const failures: string[] = [];
  const ordersCreated = new Set<string>();

  for (const scenario of dataset.scenarios) {
    const executed: string[] = [];
    const registry = deps.tools?.(scenario) ?? defaultTools(scenario, executed);

    const verdict = detectJailbreak({ message: scenario.message, history: scenario.history ?? [] });
    if (scenario.expect.blocked) {
      if (!verdict.blocked) failures.push(`${scenario.id}:not-blocked`);
      continue;
    }

    const result = await runAgentGraph(
      inputFor(scenario),
      {
        modelCall: deps.modelCallFor(scenario),
        tools: {
          specsFor: registry.specsFor,
          execute: async (name, args, ctx) => {
            executed.push(name);
            const execution = await registry.execute(name, args, ctx);
            if (MUTATIONS.has(name) && execution.record.ok) ordersCreated.add(scenario.id);
            return execution;
          },
        },
      },
      { signal: new AbortController().signal },
    );

    if (scenario.expect.route && result.route !== scenario.expect.route) {
      failures.push(`${scenario.id}:route=${result.route}`);
    }
    for (const expected of scenario.expect.tools) {
      if (!executed.includes(expected)) failures.push(`${scenario.id}:missing=${expected}`);
    }
    if (scenario.expect.noOrder && ordersCreated.has(scenario.id)) {
      failures.push(`${scenario.id}:unexpected-order`);
    }
  }

  const accuracy = 1 - failures.length / dataset.scenarios.length;
  return {
    category: 'agents',
    cases: dataset.scenarios.length,
    passed: accuracy >= 1,
    metrics: { accuracy, scenarios: dataset.scenarios.length },
    failures,
  };
}
