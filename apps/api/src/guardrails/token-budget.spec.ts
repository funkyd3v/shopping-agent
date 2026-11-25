import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BudgetExhaustedError,
  estimateTokens,
  startOfUtcDay,
  TOKEN_BUDGET_LIMITS,
  TokenBudgetService,
} from './token-budget.service';

type AggregateArgs = {
  where: Record<string, unknown>;
  _sum: { inputTokens: true; outputTokens: true };
};

function fakePrisma() {
  const aggregate = vi.fn(async (_args: AggregateArgs) => ({
    _sum: { inputTokens: 100, outputTokens: 50 },
  }));
  const create = vi.fn(async () => ({ id: 'usage_1' }));
  return {
    prisma: { tokenUsage: { aggregate, create } } as never,
    aggregate,
    create,
  };
}

const limits = () => ({ request: 1_000, session: 10_000, daily: 20_000 });

describe('TokenBudgetService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('estimates tokens at ~4 characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('uses the UTC day boundary', () => {
    expect(startOfUtcDay(new Date('2026-11-25T23:30:00Z')).toISOString()).toBe(
      '2026-11-25T00:00:00.000Z',
    );
  });

  it('allows a request inside all budgets', async () => {
    const { prisma, aggregate } = fakePrisma();
    const service = new TokenBudgetService(prisma, limits);
    await expect(
      service.assertAvailable({ userId: 'u1', sessionId: 's1', estimatedRequestTokens: 500 }),
    ).resolves.toBeUndefined();
    expect(aggregate).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized request before querying usage', async () => {
    const { prisma, aggregate } = fakePrisma();
    const service = new TokenBudgetService(prisma, limits);
    await expect(
      service.assertAvailable({ userId: 'u1', sessionId: 's1', estimatedRequestTokens: 1_001 }),
    ).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('rejects when the session or daily budget is exhausted', async () => {
    const session = fakePrisma();
    session.aggregate.mockResolvedValue({ _sum: { inputTokens: 9_900, outputTokens: 0 } });
    await expect(
      new TokenBudgetService(session.prisma, limits).assertAvailable({
        userId: 'u1',
        sessionId: 's1',
        estimatedRequestTokens: 200,
      }),
    ).rejects.toMatchObject({ scope: 'session' });

    const daily = fakePrisma();
    daily.aggregate
      .mockResolvedValueOnce({ _sum: { inputTokens: 19_900, outputTokens: 0 } })
      .mockResolvedValueOnce({ _sum: { inputTokens: 0, outputTokens: 0 } });
    await expect(
      new TokenBudgetService(daily.prisma, limits).assertAvailable({
        userId: 'u1',
        sessionId: 's1',
        estimatedRequestTokens: 200,
      }),
    ).rejects.toMatchObject({ scope: 'daily' });
  });

  it('records rounded, non-negative usage and swallows write failures', async () => {
    const { prisma, create } = fakePrisma();
    const service = new TokenBudgetService(prisma, limits);
    await service.record({
      userId: 'u1',
      sessionId: 's1',
      runId: 'r1',
      kind: 'rag',
      model: 'm',
      provider: 'groq',
      inputTokens: -1.4,
      outputTokens: 2.6,
      estimated: true,
      latencyMs: 3.2,
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputTokens: 0,
        outputTokens: 3,
        latencyMs: 3,
        estimated: true,
      }),
    });

    create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.record({
        userId: null,
        sessionId: null,
        runId: null,
        kind: 'embedding',
        model: 'm',
        provider: 'gemini',
        inputTokens: 1,
        outputTokens: 0,
        estimated: true,
        latencyMs: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it('exports the limits injection token', () => {
    expect(TOKEN_BUDGET_LIMITS.toString()).toContain('TOKEN_BUDGET_LIMITS');
  });
});
