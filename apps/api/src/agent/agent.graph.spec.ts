import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { type AgentGraphDeps, runAgentGraph } from './agent.graph';
import { AGENT_COPY } from './agent.policy';
import type { ToolExecution } from './agent.tools';
import type { AgentGraphInput, AgentModelCall, ListedProduct } from './agent.types';

const product = (position: number, overrides: Partial<ListedProduct> = {}): ListedProduct => ({
  id: `prod_${position}`,
  name: `Product ${position}`,
  priceCents: 1000 * position,
  ratingAvg: 4.5,
  ratingCount: 10,
  position,
  ...overrides,
});

function input(overrides: Partial<AgentGraphInput> = {}): AgentGraphInput {
  return {
    userId: 'user_1',
    sessionId: 'session_1',
    turnId: 'turn_1',
    clientMessageId: 'client-0001',
    message: 'find headphones',
    recentMessages: [],
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
    ...overrides,
  };
}

type ModelStep = Awaited<ReturnType<AgentModelCall>>;

function model(steps: ModelStep[]): AgentModelCall {
  const queue = [...steps];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected model call');
    return next;
  });
}

function step(content: string, toolCalls: ModelStep['toolCalls'] = []): ModelStep {
  return { content, toolCalls, provider: 'groq', model: 'openai/gpt-oss-20b' };
}

function execution(overrides: Partial<ToolExecution> = {}): ToolExecution {
  return {
    record: { name: 'search_products', ok: true },
    message: JSON.stringify({ trust: 'untrusted', source: 'catalog', data: {} }),
    ...overrides,
  };
}

function tools(executions: Record<string, ToolExecution> = {}): AgentGraphDeps['tools'] {
  return {
    specsFor: (agent) =>
      agent === 'search'
        ? [
            { name: 'search_products', description: '', schema: {} as never },
            { name: 'get_product', description: '', schema: {} as never },
          ]
        : agent === 'review'
          ? [{ name: 'get_reviews', description: '', schema: {} as never }]
          : agent === 'cart'
            ? [
                { name: 'view_cart', description: '', schema: {} as never },
                { name: 'add_to_cart', description: '', schema: {} as never },
                { name: 'update_cart_item', description: '', schema: {} as never },
              ]
            : [
                { name: 'list_orders', description: '', schema: {} as never },
                { name: 'get_order', description: '', schema: {} as never },
              ],
    execute: vi.fn(
      async (name: string) => executions[name] ?? execution({ record: { name, ok: true } }),
    ),
  };
}

function deps(modelCall: AgentModelCall, registry = tools()): AgentGraphDeps {
  return { modelCall, tools: registry };
}

describe('read-only agent graph', () => {
  it('routes to search, executes the tool, and returns a numbered footer', async () => {
    const listed = [product(1), product(2)];
    const registry = tools({
      search_products: execution({
        record: { name: 'search_products', ok: true },
        lastListedProducts: listed,
        products: listed.map(({ position: _position, ...rest }) => rest),
        fallbackText: AGENT_COPY.searchFallbackIntro,
      }),
    });
    const modelCall = model([
      step('{"agent":"search","confidence":0.92,"reason":"product search"}'),
      step('', [{ id: 'call_1', name: 'search_products', args: { query: 'headphones' } }]),
      step('Here are two headphones that fit your request.'),
    ]);

    const result = await runAgentGraph(input(), deps(modelCall, registry));

    expect(result.route).toBe('search');
    expect(result.reply).toContain('two headphones');
    expect(result.productFooter).toHaveLength(2);
    expect(result.lastListedProducts).toHaveLength(2);
    expect(result.toolCalls).toEqual([{ name: 'search_products', ok: true }]);
    expect(registry.execute).toHaveBeenCalledWith(
      'search_products',
      { query: 'headphones' },
      expect.objectContaining({ userId: 'user_1', sessionId: 'session_1' }),
    );
  });

  it('falls back to a grounded search when the model answers without a tool', async () => {
    const registry = tools({
      search_products: execution({
        lastListedProducts: [product(1)],
        products: [
          { id: 'prod_1', name: 'Product 1', priceCents: 1000, ratingAvg: 4.5, ratingCount: 10 },
        ],
        fallbackText: AGENT_COPY.searchFallbackIntro,
      }),
    });
    const modelCall = model([
      step('{"agent":"search","confidence":0.9,"reason":"search"}'),
      step('I think there are some good options.'),
      step('Here is one option that matches.'),
    ]);

    const result = await runAgentGraph(
      input({ message: 'find headphones under $80' }),
      deps(modelCall, registry),
    );

    expect(registry.execute).toHaveBeenCalledWith(
      'search_products',
      expect.objectContaining({ maxPrice: 80 }),
      expect.anything(),
    );
    expect(result.productFooter).toHaveLength(1);
    expect(result.reply).toBe('Here is one option that matches.');
  });

  it('resolves "the second one" from checkpointed products for reviews', async () => {
    const checkpointer = new MemorySaver();
    const listed = [product(1), product(2)];
    const registry = tools({
      search_products: execution({
        lastListedProducts: listed,
        products: listed.map(({ position: _position, ...rest }) => rest),
      }),
      get_reviews: execution({
        record: { name: 'get_reviews', ok: true },
        fallbackText: 'Customers rate Product 2 4.5/5 across 3 recent reviews.',
        reviewCount: 3,
      }),
    });
    const searchModel = model([
      step('{"agent":"search","confidence":0.9,"reason":"search"}'),
      step('', [{ id: 'call_1', name: 'search_products', args: { query: 'headphones' } }]),
      step('Here are the products.'),
    ]);
    await runAgentGraph(input(), deps(searchModel, registry), { checkpointer });

    const reviewModel = model([
      step('{"agent":"review","confidence":0.9,"reason":"reviews"}'),
      step('Here is a summary of the reviews.'),
      step('Reviewers like the fit and battery life.'),
    ]);
    const result = await runAgentGraph(
      input({ turnId: 'turn_2', message: 'summarize reviews for the second one' }),
      deps(reviewModel, registry),
      { checkpointer },
    );

    expect(result.route).toBe('review');
    expect(registry.execute).toHaveBeenCalledWith(
      'get_reviews',
      expect.objectContaining({ productId: 'prod_2' }),
      expect.anything(),
    );
    expect(result.reply).toContain('fit and battery');
  });

  it('asks for a product when reviews are requested without a listed product', async () => {
    const registry = tools();
    const modelCall = model([
      step('{"agent":"review","confidence":0.9,"reason":"reviews"}'),
      step('Sure, here are the reviews.'),
    ]);

    const result = await runAgentGraph(
      input({ message: 'summarize reviews for the second one' }),
      deps(modelCall, registry),
    );

    expect(registry.execute).not.toHaveBeenCalled();
    expect(result.reply).toBe(AGENT_COPY.reviewNoProducts);
  });

  it('routes history to the orders tool and keeps links out of the model reply', async () => {
    const registry = tools({
      list_orders: execution({
        record: { name: 'list_orders', ok: true },
        orders: [
          {
            id: 'order_1',
            orderNumber: 'ORD-1001',
            status: 'delivered',
            totalCents: 2599,
            currency: 'USD',
          },
        ],
        fallbackText: AGENT_COPY.historyFallbackIntro,
      }),
    });
    const modelCall = model([
      step('{"agent":"history","confidence":0.9,"reason":"orders"}'),
      step('', [{ id: 'call_1', name: 'list_orders', args: { limit: 5 } }]),
      step('Here are your most recent orders.'),
    ]);

    const result = await runAgentGraph(
      input({ message: 'show my last orders' }),
      deps(modelCall, registry),
    );

    expect(result.route).toBe('history');
    expect(result.orderFooter).toHaveLength(1);
    expect(result.reply).not.toContain('ORD-1001');
  });

  it('adds the second listed product to the cart and returns a cart footer', async () => {
    const checkpointer = new MemorySaver();
    const listed = [product(1), product(2)];
    const cartSummary = {
      items: [{ productId: 'prod_2', name: 'Product 2', qty: 2, unitPriceCents: 2000 }],
      subtotalCents: 4000,
    };
    const registry = tools({
      search_products: execution({
        lastListedProducts: listed,
        products: listed.map(({ position: _position, ...rest }) => rest),
      }),
      add_to_cart: execution({
        record: { name: 'add_to_cart', ok: true },
        cartSummary,
        fallbackText: 'Added 2 × Product 2 to your cart.',
      }),
    });
    const searchModel = model([
      step('{"agent":"search","confidence":0.9,"reason":"search"}'),
      step('', [{ id: 'call_1', name: 'search_products', args: { query: 'headphones' } }]),
      step('Here are the products.'),
    ]);
    await runAgentGraph(input(), deps(searchModel, registry), { checkpointer });

    const cartModel = model([
      step('{"agent":"cart","confidence":0.95,"reason":"cart"}'),
      step('', [{ id: 'call_2', name: 'add_to_cart', args: { productId: 'prod_2', qty: 2 } }]),
      step('Added it to your cart.'),
    ]);
    const result = await runAgentGraph(
      input({ turnId: 'turn_2', message: 'add 2 of the second one to my cart' }),
      deps(cartModel, registry),
      { checkpointer },
    );

    expect(result.route).toBe('cart');
    expect(registry.execute).toHaveBeenCalledWith(
      'add_to_cart',
      { productId: 'prod_2', qty: 2 },
      expect.objectContaining({ userId: 'user_1' }),
    );
    expect(result.cartFooter).toEqual(cartSummary);
    expect(result.lastCartSummary).toEqual(cartSummary);
    expect(result.reply).toContain('Added it');
  });

  it('falls back to a deterministic cart add when the model answers without a tool', async () => {
    const checkpointer = new MemorySaver();
    const listed = [product(1), product(2)];
    const cartSummary = {
      items: [{ productId: 'prod_2', name: 'Product 2', qty: 2, unitPriceCents: 2000 }],
      subtotalCents: 4000,
    };
    const registry = tools({
      search_products: execution({
        lastListedProducts: listed,
        products: listed.map(({ position: _position, ...rest }) => rest),
      }),
      add_to_cart: execution({ cartSummary }),
    });
    const searchModel = model([
      step('{"agent":"search","confidence":0.9,"reason":"search"}'),
      step('', [{ id: 'call_1', name: 'search_products', args: { query: 'headphones' } }]),
      step('Here are the products.'),
    ]);
    await runAgentGraph(input(), deps(searchModel, registry), { checkpointer });

    const cartModel = model([
      step('{"agent":"cart","confidence":0.95,"reason":"cart"}'),
      step('I can add that for you.'),
      step('Done.'),
    ]);
    const result = await runAgentGraph(
      input({ turnId: 'turn_2', message: 'add 2 of the second one to my cart' }),
      deps(cartModel, registry),
      { checkpointer },
    );

    expect(registry.execute).toHaveBeenCalledWith(
      'add_to_cart',
      { productId: 'prod_2', qty: 2 },
      expect.anything(),
    );
    expect(result.cartFooter).toEqual(cartSummary);
    expect(result.reply).toBe('Done.');
  });

  it('does not change the cart for non-committal language', async () => {
    const registry = tools();
    const modelCall = model([
      step('{"agent":"cart","confidence":0.95,"reason":"cart"}'),
      step('I could add that if you want.'),
    ]);

    const result = await runAgentGraph(
      input({ message: "I'm thinking about adding the second one to my cart" }),
      deps(modelCall, registry),
    );

    expect(result.route).toBe('cart');
    expect(result.reply).toBe(AGENT_COPY.cartNonCommittal);
    expect(registry.execute).not.toHaveBeenCalled();
    expect(result.cartFooter).toBeNull();
  });

  it('uses the deterministic heuristic when the router is low-confidence', async () => {
    const registry = tools({
      search_products: execution({
        lastListedProducts: [product(1)],
        products: [
          { id: 'prod_1', name: 'Product 1', priceCents: 1000, ratingAvg: 4.5, ratingCount: 10 },
        ],
      }),
    });
    const modelCall = model([
      step('{"agent":"clarify","confidence":0.2,"reason":"unsure"}'),
      step('Here is a grounded answer.'),
    ]);

    const result = await runAgentGraph(
      input({ message: 'find wireless headphones' }),
      deps(modelCall, registry),
    );

    expect(result.route).toBe('search');
    expect(result.routeSource).toBe('fallback');
    expect(registry.execute).toHaveBeenCalled();
  });

  it('caps tool calls and still answers', async () => {
    const registry = tools();
    const manyCalls = Array.from({ length: 6 }, (_, index) => ({
      id: `call_${index}`,
      name: 'search_products',
      args: {},
    }));
    const modelCall = model([
      step('{"agent":"search","confidence":0.9,"reason":"search"}'),
      step('', manyCalls),
      step('I reached the limit.'),
    ]);

    const result = await runAgentGraph(input(), deps(modelCall, registry));

    expect(registry.execute).toHaveBeenCalledTimes(4);
    expect(result.toolCalls.filter((call) => call.errorCode === 'TOOL_LIMIT')).toHaveLength(2);
    expect(result.reply).toBe('I reached the limit.');
  });

  it('uses the deterministic intro when the specialist model fails', async () => {
    const registry = tools({
      list_orders: execution({
        record: { name: 'list_orders', ok: true },
        orders: [
          {
            id: 'order_1',
            orderNumber: 'ORD-1001',
            status: 'delivered',
            totalCents: 2599,
            currency: 'USD',
          },
        ],
        fallbackText: AGENT_COPY.historyFallbackIntro,
      }),
    });
    const routerStep = step('{"agent":"history","confidence":0.9,"reason":"orders"}');
    let calls = 0;
    const modelCall = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return routerStep;
      throw new Error('provider down');
    }) as unknown as AgentModelCall;

    const result = await runAgentGraph(
      input({ message: 'show my orders' }),
      deps(modelCall, registry),
    );

    expect(result.reply).toBe(AGENT_COPY.historyFallbackIntro);
    expect(result.orderFooter).toHaveLength(1);
  });
});
