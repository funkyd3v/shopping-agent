import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
});
