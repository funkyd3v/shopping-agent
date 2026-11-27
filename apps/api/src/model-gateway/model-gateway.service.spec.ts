import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CassetteStore } from './cassette.store.js';
import {
  type ChatMessage,
  GatewayError,
  type InvokeFn,
  ModelGatewayService,
} from './model-gateway.service.js';

const messages: ChatMessage[] = [{ role: 'user', content: 'When do orders ship?' }];

/** Build a service with an injected transport so no SDK or network is touched. */
function service(invokeFn?: InvokeFn): ModelGatewayService {
  return new ModelGatewayService(new CassetteStore(), invokeFn);
}

describe('ModelGatewayService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    process.env.GOOGLE_API_KEY = 'test-google-key';
    process.env.LLM_MODE = 'live';
    process.env.MODEL_TIMEOUT_MS = '2000';
    delete process.env.PROVIDER_DISABLE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('serves from the primary model when it succeeds', async () => {
    const invoke = vi.fn(async () => 'primary answer');
    const result = await service(invoke).generate({ chain: 'router', messages });

    expect(result).toMatchObject({
      content: 'primary answer',
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      attempt: 0,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next model when the primary fails', async () => {
    const calls: string[] = [];
    const invoke: InvokeFn = async ({ provider, model }) => {
      calls.push(`${provider}/${model}`);
      if (provider === 'groq') throw new Error('service unavailable');
      return 'fallback answer';
    };

    const result = await service(invoke).generate({ chain: 'router', messages });

    expect(result).toMatchObject({
      content: 'fallback answer',
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      attempt: 1,
    });
    expect(calls).toEqual(['groq/openai/gpt-oss-20b', 'gemini/gemini-3.5-flash-lite']);
  });

  it('throws ALL_MODELS_FAILED when every model fails', async () => {
    const invoke: InvokeFn = async () => {
      throw new Error('boom');
    };

    await expect(service(invoke).generate({ chain: 'router', messages })).rejects.toMatchObject({
      name: 'GatewayError',
      code: 'ALL_MODELS_FAILED',
    });
  });

  it('skips a provider whose API key is missing', async () => {
    delete process.env.GROQ_API_KEY;
    const invoke = vi.fn(async () => 'gemini only');

    const result = await service(invoke).generate({ chain: 'router', messages });

    expect(result.provider).toBe('gemini');
    expect(result.attempt).toBe(0);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('still answers when a provider is disabled (Phase 1 acceptance)', async () => {
    process.env.PROVIDER_DISABLE = 'groq';
    const invoke = vi.fn(async () => 'via fallback');
    const gateway = service(invoke);

    const result = await gateway.generate({ chain: 'router', messages });

    expect(result.provider).toBe('gemini');
    expect(gateway.providerHealth()).toContainEqual({
      provider: 'groq',
      disabled: true,
      reason: 'PROVIDER_DISABLE',
    });
  });

  it('trips the provider breaker after repeated quota errors', async () => {
    const invoke: InvokeFn = async () => {
      throw new Error('429 rate limit exceeded');
    };
    const gateway = service(invoke);

    for (let i = 0; i < 3; i++) {
      await expect(gateway.generate({ chain: 'router', messages })).rejects.toBeInstanceOf(
        GatewayError,
      );
    }

    expect(gateway.providerHealth()).toContainEqual({
      provider: 'groq',
      disabled: true,
      reason: 'quota cooldown',
    });
  });

  it('fails with NO_CASSETTE in replay mode instead of calling the network', async () => {
    process.env.LLM_MODE = 'replay';
    const gateway = service();

    await expect(gateway.generate({ chain: 'router', messages })).rejects.toMatchObject({
      code: 'NO_CASSETTE',
    });
  });

  it('rejects an unknown chain', async () => {
    await expect(
      service(async () => 'nope').generate({ chain: 'no-such-chain', messages }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('honours capability requirements when selecting a model', async () => {
    const invoke = vi.fn(async () => 'structured answer');
    const result = await service(invoke).generate({
      chain: 'router',
      messages,
      require: ['structured'],
    });

    expect(result.provider).toBe('gemini');
  });

  it('does not call a provider when the request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const invoke = vi.fn(async () => 'should not run');

    await expect(
      service(invoke).generate({ chain: 'router', messages, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('aborts an in-flight call without falling back to another provider', async () => {
    const controller = new AbortController();
    const invoke = vi.fn(async () => {
      controller.abort();
      return await new Promise<string>(() => undefined);
    });

    await expect(
      service(invoke).generate({ chain: 'router', messages, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  describe('provider hardening (PLAN §6)', () => {
    const noDelay = { baseMs: 0, maxMs: 0, jitter: false };

    function hardened(invokeFn?: InvokeFn): ModelGatewayService {
      return new ModelGatewayService(new CassetteStore(), invokeFn, undefined, noDelay);
    }

    it('retries the next provider on a 5xx with backoff', async () => {
      const calls: string[] = [];
      const invoke: InvokeFn = async ({ provider }) => {
        calls.push(provider);
        if (provider === 'groq') {
          throw Object.assign(new Error('upstream 503'), { status: 503 });
        }
        return 'recovered answer';
      };

      const result = await hardened(invoke).generate({ chain: 'router', messages });

      expect(result.content).toBe('recovered answer');
      expect(result.attempt).toBe(1);
      expect(calls).toEqual(['groq', 'gemini']);
    });

    it('does not fall back after a fatal 401', async () => {
      const invoke = vi.fn(async () => {
        throw Object.assign(new Error('bad api key'), { status: 401 });
      });

      await expect(hardened(invoke).generate({ chain: 'router', messages })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('uses provider usage metadata instead of estimating it', async () => {
      const invoke: InvokeFn = async () => ({
        content: 'answer',
        usage: { inputTokens: 11, outputTokens: 7, estimated: false },
      });

      const result = await hardened(invoke).generate({ chain: 'router', messages });

      expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7, estimated: false });
    });

    it('stops using providers whose daily token budget is spent', async () => {
      process.env.PROVIDER_DAILY_TOKEN_BUDGET = '1';
      const invoke: InvokeFn = async () => 'answer';
      const gateway = hardened(invoke);

      await gateway.generate({ chain: 'router', messages }); // groq
      await gateway.generate({ chain: 'router', messages }); // gemini
      await expect(gateway.generate({ chain: 'router', messages })).rejects.toMatchObject({
        code: 'NO_MODEL_AVAILABLE',
      });
    });
  });

  describe('generateWithTools', () => {
    const tools = [
      {
        name: 'search_products',
        description: 'Search the catalog',
        schema: z.object({ query: z.string().optional() }),
      },
    ];

    it('returns normalized tool calls from the primary model', async () => {
      const toolInvoke = vi.fn(async () => ({
        content: '',
        toolCalls: [{ name: 'search_products', args: '{"query":"headphones"}' }],
      }));
      const gateway = new ModelGatewayService(new CassetteStore(), undefined, toolInvoke as never);

      const result = await gateway.generateWithTools({
        chain: 'agent',
        messages,
        tools,
        temperature: 0.2,
      });

      expect(result.provider).toBe('groq');
      expect(result.toolCalls).toEqual([
        { id: 'call_1', name: 'search_products', args: { query: 'headphones' } },
      ]);
      expect(toolInvoke).toHaveBeenCalledTimes(1);
    });

    it('falls back to the next model when tool calling fails', async () => {
      const calls: string[] = [];
      const toolInvoke = vi.fn(async ({ provider }: { provider: string }) => {
        calls.push(provider);
        if (provider === 'groq') throw new Error('tool calling unavailable');
        return { content: 'fallback answer', toolCalls: [] };
      });
      const gateway = new ModelGatewayService(new CassetteStore(), undefined, toolInvoke as never);

      const result = await gateway.generateWithTools({ chain: 'agent', messages, tools });

      expect(result.provider).toBe('gemini');
      expect(result.toolCalls).toEqual([]);
      expect(calls).toEqual(['groq', 'gemini']);
    });

    it('fails with NO_CASSETTE in replay mode', async () => {
      process.env.LLM_MODE = 'replay';
      const gateway = new ModelGatewayService(new CassetteStore());

      await expect(
        gateway.generateWithTools({ chain: 'agent', messages, tools }),
      ).rejects.toMatchObject({ code: 'NO_CASSETTE' });
    });
  });
});
