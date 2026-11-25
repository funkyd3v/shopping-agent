import { describe, expect, it, vi } from 'vitest';
import type { PreparedTurn } from '../chat/chat-session.service';
import { RAG_COPY, RAG_POLICY } from '../guardrails/guardrails.policy';
import { BudgetExhaustedError } from '../guardrails/token-budget.service';
import type { ChatMessage } from '../model-gateway/model-gateway.service';
import { RagService, type RagTuning } from './rag.service';
import type { RetrievedChunk } from './retriever';
import { TurnAbortedError } from './retriever';

const tuning: RagTuning = {
  ...RAG_POLICY,
  topK: 3,
  maxDistance: 0.38,
};

function preparedTurn(content = 'What is the shipping policy?'): PreparedTurn {
  return {
    session: {
      id: 'session_1',
      userId: 'user_1',
      kind: 'rag',
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

const chunk = (overrides: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  id: 'chunk_1',
  source: 'shipping.md',
  title: 'Shipping Policy',
  section: 'Shipping methods and rates',
  content: 'Standard shipping is $5.95 and free over $50.00.',
  distance: 0.1,
  ...overrides,
});

type Setup = {
  answer?: string;
  classifier?: string;
  chunks?: RetrievedChunk[];
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  gatewayError?: Error;
  retrievalError?: Error;
  embedError?: Error;
  budgetError?: Error;
  signal?: AbortSignal;
};

function setup(options: Setup = {}) {
  const embedded: string[] = [];
  const persisted: unknown[] = [];
  const guardrails: unknown[] = [];
  const progress: string[] = [];

  const gateway = {
    generate: vi.fn(async ({ chain }: { chain: string; messages: ChatMessage[] }) => {
      if (options.gatewayError) throw options.gatewayError;
      return {
        content:
          chain === 'rag'
            ? (options.answer ?? 'Standard shipping is $5.95 and free over $50.00.')
            : (options.classifier ?? '{"inScope":true,"confidence":0.9}'),
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        attempt: 0,
        elapsedMs: 1,
      };
    }),
  };

  const sessions = {
    updateUserModelContent: vi.fn(async () => undefined),
    loadRecentTurns: vi.fn(async () => options.history ?? []),
    persistAssistant: vi.fn(async (input: unknown) => {
      persisted.push(input);
      return {};
    }),
  };

  const guardrailService = {
    record: vi.fn(async (input: unknown) => {
      guardrails.push(input);
    }),
  };

  const budgets = {
    assertAvailable: vi.fn(async () => {
      if (options.budgetError) throw options.budgetError;
    }),
    record: vi.fn(async () => undefined),
  };

  const retriever = {
    retrieve: vi.fn(async () => {
      if (options.retrievalError) throw options.retrievalError;
      return options.chunks ?? [chunk()];
    }),
  };

  const embedder = {
    embed: vi.fn(async (text: string) => {
      if (options.embedError) throw options.embedError;
      embedded.push(text);
      return [0.1, 0.2, 0.3];
    }),
  };

  const service = new RagService(
    gateway as never,
    sessions as never,
    guardrailService as never,
    budgets as never,
    retriever,
    embedder,
    tuning,
  );

  return {
    service,
    gateway,
    sessions,
    guardrails,
    budgets,
    retriever,
    embedder,
    embedded,
    persisted,
    progress,
  };
}

const contextFor = (options: Setup = {}) => {
  const setupResult = setup(options);
  return {
    ...setupResult,
    signal: options.signal ?? new AbortController().signal,
    onProgress: (phase: 'thinking' | 'generating') => setupResult.progress.push(phase),
  };
};

function ruleNames(records: unknown[]): string[] {
  return records.map((record) => (record as { rule: string }).rule);
}

describe('RagService.run', () => {
  it('answers from retrieved context, appends sources, and persists before returning', async () => {
    const { service, sessions, embedded, progress } = contextFor();
    const turn = preparedTurn();

    const result = await service.run(turn, {
      signal: new AbortController().signal,
      onProgress: (phase) => progress.push(phase),
    });

    expect(result.status).toBe('ok');
    expect(result.text).toContain('Standard shipping is $5.95');
    expect(result.text).toContain('Sources:\n- Shipping Policy — Shipping methods and rates');
    expect(result.sources).toEqual([
      { source: 'shipping.md', title: 'Shipping Policy', section: 'Shipping methods and rates' },
    ]);
    expect(embedded).toEqual(['What is the shipping policy?']);
    expect(progress).toEqual(['generating']);
    expect(sessions.persistAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: 'message_2', status: 'complete', content: result.text }),
    );
  });

  it('redacts input PII before embedding or prompting', async () => {
    const { service, sessions, guardrails, embedded } = contextFor();
    const turn = preparedTurn('What is the shipping policy? Email alice@example.com');

    await service.run(turn, { signal: new AbortController().signal });

    expect(sessions.updateUserModelContent).toHaveBeenCalledWith(
      'message_1',
      'What is the shipping policy? Email [REDACTED_EMAIL]',
    );
    expect(embedded[0]).not.toContain('alice@example.com');
    expect(ruleNames(guardrails)).toContain('pii.input');
  });

  it('redirects an out-of-scope request without retrieving or calling models', async () => {
    const { service, guardrails, embedder, retriever, sessions } = contextFor();
    const turn = preparedTurn('Add two of the cheapest monitors to my cart.');

    const result = await service.run(turn, { signal: new AbortController().signal });

    expect(result.text).toBe(RAG_COPY.outOfScope);
    expect(embedder.embed).not.toHaveBeenCalled();
    expect(retriever.retrieve).not.toHaveBeenCalled();
    expect(ruleNames(guardrails)).toContain('rag.scope');
    expect(sessions.persistAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ content: RAG_COPY.outOfScope, status: 'complete' }),
    );
  });

  it('returns the no-match copy when every chunk is above maxDistance', async () => {
    const { service, guardrails } = contextFor({
      chunks: [chunk({ distance: 0.6 }), chunk({ id: 'chunk_2', distance: 0.8 })],
    });

    const result = await service.run(preparedTurn(), { signal: new AbortController().signal });

    expect(result.text).toBe(RAG_COPY.noMatch);
    expect(result.sources).toEqual([]);
    expect(ruleNames(guardrails)).toContain('rag.no_match');
  });

  it('omits sources when the grounded model reports it cannot answer', async () => {
    const { service, sessions } = contextFor({ answer: RAG_COPY.noMatch });

    const result = await service.run(preparedTurn(), { signal: new AbortController().signal });

    expect(result.text).toBe(RAG_COPY.noMatch);
    expect(result.sources).toEqual([]);
    expect(sessions.persistAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ content: RAG_COPY.noMatch, sources: [] }),
    );
  });

  it('degrades to a friendly message when retrieval or embeddings are unavailable', async () => {
    const retrieval = contextFor({ retrievalError: new Error('chroma down') });
    const first = await retrieval.service.run(preparedTurn(), {
      signal: new AbortController().signal,
    });
    expect(first.text).toBe(RAG_COPY.unavailable);
    expect(ruleNames(retrieval.guardrails)).toContain('rag.unavailable');

    const embedding = contextFor({ embedError: new Error('no key') });
    const second = await embedding.service.run(preparedTurn(), {
      signal: new AbortController().signal,
    });
    expect(second.text).toBe(RAG_COPY.unavailable);
    expect(ruleNames(embedding.guardrails)).toContain('rag.embedding_unavailable');
  });

  it('returns a retryable error turn when the answer model fails', async () => {
    const { service, sessions } = contextFor({ gatewayError: new Error('provider down') });

    const result = await service.run(preparedTurn(), { signal: new AbortController().signal });

    expect(result).toMatchObject({
      status: 'error',
      text: RAG_COPY.providerError,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
    });
    expect(sessions.persistAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ content: RAG_COPY.providerError, status: 'error' }),
    );
  });

  it('returns the budget copy and records the guardrail', async () => {
    const { service, guardrails, embedder } = contextFor({
      budgetError: new BudgetExhaustedError('session'),
    });

    const result = await service.run(preparedTurn(), { signal: new AbortController().signal });

    expect(result.text).toBe(RAG_COPY.budgetExhausted);
    expect(embedder.embed).not.toHaveBeenCalled();
    expect(ruleNames(guardrails)).toContain('budget');
  });

  it('sanitizes and re-redacts model output before persisting', async () => {
    const { service, guardrails } = contextFor({
      answer: '<b>Email alice@example.com</b> and see [here](javascript:alert(1)).',
    });

    const result = await service.run(preparedTurn(), { signal: new AbortController().signal });

    expect(result.text).not.toContain('<b>');
    expect(result.text).not.toContain('alice@example.com');
    expect(result.text).not.toContain('javascript:');
    expect(result.text).toContain('[REDACTED_EMAIL]');
    expect(ruleNames(guardrails)).toContain('pii.output');
  });

  it('condenses a follow-up using recent redacted history', async () => {
    const { service, gateway, embedded } = contextFor({
      history: [
        { role: 'user', content: 'How long does shipping take?' },
        { role: 'assistant', content: 'Standard shipping takes 3–5 business days.' },
      ],
    });
    const turn = preparedTurn('What about returns?');
    gateway.generate.mockImplementation(async ({ chain }: { chain: string }) => ({
      content:
        chain === 'router' ? 'What is the return policy?' : 'Returns are accepted within 30 days.',
      provider: 'groq',
      model: 'm',
      attempt: 0,
      elapsedMs: 1,
    }));

    const result = await service.run(turn, { signal: new AbortController().signal });

    expect(gateway.generate).toHaveBeenCalledWith(
      expect.objectContaining({ chain: 'router', signal: expect.any(AbortSignal) }),
    );
    expect(embedded).toEqual(['What is the return policy?']);
    expect(result.status).toBe('ok');
  });

  it('treats a context-dependent policy follow-up as in scope even if condensation fails', async () => {
    const { service, gateway, embedder, guardrails } = contextFor({
      history: [
        { role: 'user', content: 'How long does standard shipping take?' },
        { role: 'assistant', content: 'Standard shipping takes 3–5 business days.' },
      ],
    });
    gateway.generate.mockImplementation(async ({ chain }: { chain: string }) => ({
      content:
        chain === 'router'
          ? 'What about Canada?'
          : 'Canadian standard shipping takes 5–7 business days.',
      provider: 'gemini',
      model: 'm',
      attempt: 0,
      elapsedMs: 1,
    }));

    const result = await service.run(preparedTurn('What about Canada?'), {
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('ok');
    expect(embedder.embed).toHaveBeenCalledWith('What about Canada?');
    expect(ruleNames(guardrails)).not.toContain('rag.scope');
  });

  it('stops before persisting when the request is aborted', async () => {
    const controller = new AbortController();
    const { service, sessions } = contextFor({ signal: controller.signal });
    controller.abort();

    await expect(service.run(preparedTurn(), { signal: controller.signal })).rejects.toBeInstanceOf(
      TurnAbortedError,
    );
    expect(sessions.persistAssistant).not.toHaveBeenCalled();
  });
});
