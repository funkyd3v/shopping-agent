import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ulid } from 'ulid';
import { getEnv } from '../config/env';
import { PrismaService } from '../db/prisma.service';

export const TOKEN_BUDGET_LIMITS = Symbol('TOKEN_BUDGET_LIMITS');

export type BudgetLimits = {
  request: number;
  session: number;
  daily: number;
};

export type TokenUsageKind = 'router' | 'guardrail' | 'agent' | 'rag' | 'summarizer' | 'embedding';

export type TokenUsageRecord = {
  userId: string | null;
  sessionId: string | null;
  runId: string | null;
  kind: TokenUsageKind;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  latencyMs: number;
};

export class BudgetExhaustedError extends Error {
  readonly code = 'BUDGET_EXHAUSTED';

  constructor(readonly scope: 'request' | 'session' | 'daily') {
    super(`Token budget exhausted (${scope})`);
    this.name = 'BudgetExhaustedError';
  }
}

/** ~4 characters per token; used only when the provider returns no usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

type UsageSum = {
  _sum: { inputTokens: number | null; outputTokens: number | null };
};

/**
 * Pre-flight budget checks and usage recording (PLAN §10.2 `tokenBudget` /
 * `usageRecorder`). Provider-quota breakers stay in the model gateway.
 */
@Injectable()
export class TokenBudgetService {
  private readonly logger = new Logger(TokenBudgetService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(TOKEN_BUDGET_LIMITS)
    private readonly limits?: () => BudgetLimits,
  ) {}

  private currentLimits(): BudgetLimits {
    if (this.limits) return this.limits();
    const env = getEnv();
    return {
      request: env.REQUEST_TOKEN_BUDGET,
      session: env.SESSION_TOKEN_BUDGET,
      daily: env.DAILY_TOKEN_BUDGET,
    };
  }

  /** Throws `BudgetExhaustedError` before any model call when a budget is spent. */
  async assertAvailable(input: {
    userId: string;
    sessionId: string;
    estimatedRequestTokens: number;
  }): Promise<void> {
    const limits = this.currentLimits();
    if (input.estimatedRequestTokens > limits.request) {
      throw new BudgetExhaustedError('request');
    }

    const [daily, session] = await Promise.all([
      this.sum({
        userId: input.userId,
        createdAt: { gte: startOfUtcDay(new Date()) },
      }),
      this.sum({ sessionId: input.sessionId }),
    ]);

    if (daily + input.estimatedRequestTokens > limits.daily) {
      throw new BudgetExhaustedError('daily');
    }
    if (session + input.estimatedRequestTokens > limits.session) {
      throw new BudgetExhaustedError('session');
    }
  }

  /** Persist one model/embedding call. Never throws into the chat path. */
  async record(usage: TokenUsageRecord): Promise<void> {
    try {
      await this.prisma.tokenUsage.create({
        data: {
          id: ulid(),
          userId: usage.userId,
          sessionId: usage.sessionId,
          runId: usage.runId,
          kind: usage.kind,
          model: usage.model,
          provider: usage.provider,
          inputTokens: Math.max(0, Math.round(usage.inputTokens)),
          outputTokens: Math.max(0, Math.round(usage.outputTokens)),
          estimated: usage.estimated,
          latencyMs: Math.max(0, Math.round(usage.latencyMs)),
        },
      });
    } catch (error) {
      this.logger.warn(`token usage not recorded: ${String(error)}`);
    }
  }

  private async sum(where: Record<string, unknown>): Promise<number> {
    const result = (await this.prisma.tokenUsage.aggregate({
      where,
      _sum: { inputTokens: true, outputTokens: true },
    })) as UsageSum;
    return (result._sum.inputTokens ?? 0) + (result._sum.outputTokens ?? 0);
  }
}
