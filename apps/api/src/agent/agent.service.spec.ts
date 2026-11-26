import { describe, expect, it, vi } from 'vitest';
import type { PreparedTurn } from '../chat/chat-session.service';
import { TurnAbortedError } from '../common/turn-abort';
import { BudgetExhaustedError } from '../guardrails/token-budget.service';
import { GatewayError } from '../model-gateway/model-gateway.service';
import { AGENT_COPY, AGENT_PROMPT_VERSIONS } from './agent.policy';
import { AgentService } from './agent.service';
import type { ToolExecution } from './agent.tools';

function preparedTurn(content = 'find headphones under $80'): PreparedTurn {
  return {
    session: {
      id: 'session_1',
      userId: 'user_1',
      kind: 'agent',
      title: null,
      createdAt: new Date('2026-11-25T00:00:00Z'),
      updatedAt: new Date('2026-11-25T00:00:00Z'),
    },
    userMessage: {
      id: 'message_1',
      sessionId: 'session_1',
      seq: 1,
      role: 'user',
      content,
      modelContent: null,
      metadataJson: null,
      status: 'complete',
      clientMessageId: 'client-0001',
      createdAt: new Date('2026-11-25T00:00:00Z'),
    },
    turnId: 'message_2',
    runId: 'run_1',
    assistant: null,
    isReplay: false,
    release: () => undefined,
  };
}

type Setup = {
  router?: string;
  reply?: string;
  toolCall?: { id: string; name: string; args: unknown };
  execution?: ToolExecution;
  gatewayError?: Error;
  budgetError?: Error;
  executeError?: Error;
  signal?: AbortSignal;
};

function setup(options: Setup = {}) {
  const persisted: Array<Record<string, unknown>> = [];
  const guardrails: Array<Record<string, unknown>> = [];
  const runs: Array<Record<string, unknown>> = [];
  const usage: Array<Record<string, unknown>> = [];

  const gateway = {
    generate: vi.fn(async ({ chain }: { chain: string }) => {
      if (options.gatewayError) throw options.gatewayError;
      return {
        content:
          chain === 'router'
            ? (options.router ?? '{"agent":"search","confidence":0.9,"reason":"search"}')
            : (options.reply ?? 'Here are the results.'),
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        attempt: 0,
        elapsedMs: 1,
      };
    }),
    generateWithTools: vi.fn(async () => {
      if (options.gatewayError) throw options.gatewayError;
      const call = gateway.generateWithTools.mock.calls.length;
      if (options.toolCall && call === 1) {
        return {
          content: '',
          toolCalls: [options.toolCall],
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          attempt: 0,
          elapsedMs: 1,
        };
      }
      return {
        content: options.reply ?? 'Here are the results.',
        toolCalls: [],
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        attempt: 0,
        elapsedMs: 1,
      };
    }),
  };

  const sessions = {
    updateUserModelContent: vi.fn(async () => undefined),
    loadRecentTurns: vi.fn(async () => []),
    persistAssistant: vi.fn(async (input: Record<string, unknown>) => {
      persisted.push(input);
      return {};
    }),
  };

  const guardrailService = {
    record: vi.fn(async (input: Record<string, unknown>) => {
      guardrails.push(input);
    }),
  };

  const budgets = {
    assertAvailable: vi.fn(async () => {
      if (options.budgetError) throw options.budgetError;
    }),
    record: vi.fn(async (input: Record<string, unknown>) => {
      usage.push(input);
    }),
  };

  const tools = {
    specsFor: () => [
      { name: 'search_products', description: '', schema: {} as never },
      { name: 'get_product', description: '', schema: {} as never },
    ],
    execute: vi.fn(async (name: string): Promise<ToolExecution> => {
      if (options.executeError) throw options.executeError;
      return (
        options.execution ?? {
          record: { name, ok: true },
          message: JSON.stringify({ trust: 'untrusted', source: 'catalog', data: {} }),
          fallbackText: AGENT_COPY.searchFallbackIntro,
          lastListedProducts: [
            {
              id: 'prod_1',
              name: 'Wireless Headphones',
              priceCents: 7999,
              ratingAvg: 4.6,
              ratingCount: 12,
              position: 1,
            },
          ],
          products: [
            {
              id: 'prod_1',
              name: 'Wireless Headphones',
              priceCents: 7999,
              ratingAvg: 4.6,
              ratingCount: 12,
            },
          ],
        }
      );
    }),
  };

  const runService = {
    record: vi.fn(async (input: Record<string, unknown>) => {
      runs.push(input);
    }),
  };

  const service = new AgentService(
    gateway as never,
    sessions as never,
    guardrailService as never,
    budgets as never,
    tools as never,
    runService as never,
  );

  return { service, gateway, sessions, guardrails, budgets, tools, runs, persisted, usage };
}

describe('AgentService', () => {
  it('runs search, appends the server footer, and records the run', async () => {
    const { service, sessions, runs, usage, persisted } = setup({
      toolCall: { id: 'call_1', name: 'search_products', args: { query: 'headphones' } },
      reply: 'Here are two good options.',
    });

    const result = await service.run(preparedTurn(), { signal: new AbortController().signal });

    expect(result.status).toBe('ok');
    expect(result.route).toBe('search');
    expect(result.text).toContain('Here are two good options.');
    expect(result.text).toContain('Products:');
    expect(result.text).toContain('/products/prod_1');
    expect(persisted.at(-1)).toMatchObject({
      content: result.text,
      status: 'complete',
      sources: [],
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      route: 'search',
      agent: 'search',
      promptVersion: AGENT_PROMPT_VERSIONS.search,
      status: 'ok',
      toolCalls: [{ name: 'search_products', ok: true }],
    });
    expect(usage.length).toBeGreaterThanOrEqual(2);
    expect(sessions.updateUserModelContent).toHaveBeenCalledWith('message_1', expect.any(String));
  });

  it('redacts input PII before the model sees it and records the guardrail', async () => {
    const { service, sessions, guardrails } = setup();

    await service.run(preparedTurn('email me at jane@example.com'), {
      signal: new AbortController().signal,
    });

    expect(sessions.updateUserModelContent).toHaveBeenCalledWith(
      'message_1',
      'email me at [REDACTED_EMAIL]',
    );
    expect(guardrails).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'pii.input', action: 'redact' })]),
    );
  });

  it('redacts PII in the model reply before persisting', async () => {
    const { service, guardrails, persisted } = setup({
      toolCall: { id: 'call_1', name: 'search_products', args: {} },
      reply: 'Contact jane@example.com for help.',
    });

    const result = await service.run(preparedTurn(), { signal: new AbortController().signal });

    expect(result.text).toContain('[REDACTED_EMAIL]');
    expect(result.text).not.toContain('jane@example.com');
    expect(persisted.at(-1)).toMatchObject({ content: result.text });
    expect(guardrails).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'pii.output', action: 'redact' })]),
    );
  });

  it('persists the budget copy and records a limit run', async () => {
    const { service, runs, persisted } = setup({
      budgetError: new BudgetExhaustedError('session'),
    });

    const result = await service.run(preparedTurn(), { signal: new AbortController().signal });

    expect(result.text).toBe(AGENT_COPY.budgetExhausted);
    expect(persisted.at(-1)).toMatchObject({
      content: AGENT_COPY.budgetExhausted,
      status: 'complete',
    });
    expect(runs[0]).toMatchObject({ status: 'limit', errorCode: 'BUDGET_EXHAUSTED' });
  });

  it('degrades to the provider error copy when the graph throws unexpectedly', async () => {
    const { service, runs, persisted } = setup({ executeError: new Error('db down') });

    const result = await service.run(preparedTurn(), { signal: new AbortController().signal });

    expect(result.status).toBe('error');
    expect(result.text).toBe(AGENT_COPY.providerError);
    expect(persisted.at(-1)).toMatchObject({ content: AGENT_COPY.providerError, status: 'error' });
    expect(runs[0]).toMatchObject({ status: 'error', errorCode: 'AGENT_FAILED' });
  });

  it('rethrows aborts and records the aborted run', async () => {
    const controller = new AbortController();
    controller.abort();
    const { service, runs } = setup({
      gatewayError: new GatewayError('aborted', 'ABORTED', 499),
      signal: controller.signal,
    });

    await expect(service.run(preparedTurn(), { signal: controller.signal })).rejects.toBeInstanceOf(
      TurnAbortedError,
    );
    expect(runs[0]).toMatchObject({ status: 'error', errorCode: 'ABORTED' });
  });

  it('sanitizes HTML from server footer labels', async () => {
    const { service } = setup({
      toolCall: { id: 'call_1', name: 'search_products', args: {} },
      execution: {
        record: { name: 'search_products', ok: true },
        message: '{}',
        products: [
          {
            id: 'prod_1',
            name: '<script>alert(1)</script>Headphones',
            priceCents: 7999,
            ratingAvg: 4.6,
            ratingCount: 12,
          },
        ],
        fallbackText: AGENT_COPY.searchFallbackIntro,
      },
    });

    const result = await service.run(preparedTurn(), { signal: new AbortController().signal });

    expect(result.text).not.toContain('<script>');
    expect(result.text).toContain('Headphones');
  });
});
