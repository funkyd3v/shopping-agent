import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ChatRequest, ChatSource, ErrorCode, SseUsage } from '@shopping-agent/shared';
import { ChatSessionService, type PreparedTurn } from '../chat/chat-session.service';
import { getEnv } from '../config/env';
import { GuardrailService } from '../guardrails/guardrail.service';
import {
  GUARDRAIL_COPY,
  JAILBREAK_POLICY,
  RAG_COPY,
  RAG_POLICY,
  REDUNDANCY_POLICY,
} from '../guardrails/guardrails.policy';
import { detectJailbreak } from '../guardrails/jailbreak';
import { redactPii } from '../guardrails/pii';
import { detectRedundancy } from '../guardrails/redundancy';
import {
  BudgetExhaustedError,
  estimateTokens,
  TokenBudgetService,
} from '../guardrails/token-budget.service';
import type { ChatMessage } from '../model-gateway/model-gateway.service';
import { GatewayError, ModelGatewayService } from '../model-gateway/model-gateway.service';
import { EMBEDDING } from '../model-gateway/models.config';
import { condenseQuestion, needsCondense } from './condense';
import {
  buildAnswerMessages,
  buildSourcesFooter,
  sanitizeAnswer,
  sourcesFromChunks,
} from './prompt';
import {
  type PolicyRetriever,
  type QueryEmbedder,
  type RetrievedChunk,
  TurnAbortedError,
} from './retriever';
import { buildScopeClassifierMessages, resolveScope } from './scope';

export const POLICY_RETRIEVER = Symbol('POLICY_RETRIEVER');
export const QUERY_EMBEDDER = Symbol('QUERY_EMBEDDER');
export const RAG_TUNING = Symbol('RAG_TUNING');

export type RagTuning = {
  topK: number;
  maxDistance: number;
  maxSources: number;
  historyTurns: number;
  retrievalTimeoutMs: number;
  scopeMinConfidence: number;
  condenseMaxChars: number;
  maxContextChars: number;
  reservedPromptTokens: number;
  maxAnswerChars: number;
  temperature: number;
};

export type RagRunContext = {
  signal: AbortSignal;
  onProgress?: (phase: 'thinking' | 'generating') => void;
};

export type RagRunResult = {
  text: string;
  status: 'ok' | 'error';
  sources: ChatSource[];
  usage: SseUsage;
  error?: { code: ErrorCode; message: string; retryable: boolean };
};

/**
 * RAG query chain (PLAN §7): input guardrails → condense → scope → embed →
 * retrieve → distance threshold → grounded answer → output guardrails →
 * Sources footer → persist before streaming.
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly gateway: ModelGatewayService,
    private readonly sessions: ChatSessionService,
    private readonly guardrails: GuardrailService,
    private readonly budgets: TokenBudgetService,
    @Inject(POLICY_RETRIEVER) private readonly retriever: PolicyRetriever,
    @Inject(QUERY_EMBEDDER) private readonly embedder: QueryEmbedder,
    @Optional() @Inject(RAG_TUNING) private readonly tuning?: RagTuning,
  ) {}

  begin(userId: string, request: ChatRequest): Promise<PreparedTurn> {
    return this.sessions.beginTurn({
      userId,
      kind: 'rag',
      sessionId: request.sessionId,
      clientMessageId: request.clientMessageId,
      message: request.message,
    });
  }

  async run(turn: PreparedTurn, ctx: RagRunContext): Promise<RagRunResult> {
    const settings: RagTuning = this.tuning ?? RAG_POLICY;
    const usage: SseUsage = { inputTokens: 0, outputTokens: 0, estimated: true };
    const { session, userMessage } = turn;
    const userId = session.userId;

    // Input PII: raw stays for the owner; models/embeddings only see redacted text.
    const redaction = redactPii(userMessage.content);
    await this.sessions.updateUserModelContent(userMessage.id, redaction.text);
    if (redaction.findings.length > 0) {
      await this.guardrails.record({
        userId,
        sessionId: session.id,
        rule: 'pii.input',
        action: 'redact',
        details: {
          findings: redaction.findings.map((f) => `${f.kind}:${f.count}`).join(','),
        },
      });
    }
    const question = redaction.text;
    const guardrails = ragGuardrailEnv();
    const history = await this.sessions.loadRecentTurns(
      session.id,
      userMessage.seq,
      settings.historyTurns,
    );

    // Read-only chat: the heuristic is the only jailbreak layer (PLAN §10.4).
    const jailbreak = detectJailbreak({
      message: question,
      history,
      threshold: guardrails.threshold,
    });
    if (jailbreak.blocked) {
      await this.guardrails.record({
        userId,
        sessionId: session.id,
        rule: 'jailbreak',
        action: 'refuse',
        score: jailbreak.score,
        details: { reasons: jailbreak.reasons.join(','), source: 'heuristic' },
      });
      return this.finish(turn, GUARDRAIL_COPY.jailbreakBlocked, 'ok', [], usage);
    }

    try {
      await this.budgets.assertAvailable({
        userId,
        sessionId: session.id,
        estimatedRequestTokens: estimateTokens(question) + settings.reservedPromptTokens,
      });
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        await this.guardrails.record({
          userId,
          sessionId: session.id,
          rule: 'budget',
          action: 'budget',
          details: { scope: error.scope },
        });
        return this.finish(turn, RAG_COPY.budgetExhausted, 'ok', [], usage);
      }
      throw error;
    }

    // A context-dependent follow-up inside an existing policy chat is in scope
    // even if condensation fails (provider hiccup); retrieval + maxDistance still
    // guard against answering unrelated questions.
    const isPolicyFollowUp = history.length > 0 && needsCondense(question);

    let retrievalQuery = question;
    if (needsCondense(question) && history.length > 0) {
      retrievalQuery = await condenseQuestion({
        message: question,
        history,
        maxHistory: settings.historyTurns,
        generate: (messages) =>
          this.callModel({
            chain: 'router',
            messages,
            kind: 'rag',
            turn,
            ctx,
            usage,
            temperature: 0,
          }),
      });
    }

    const scope = isPolicyFollowUp
      ? { scope: 'in' as const, confidence: 0.8, source: 'heuristic' as const }
      : await resolveScope(retrievalQuery, {
          minConfidence: settings.scopeMinConfidence,
          classify: (value) =>
            this.callModel({
              chain: 'guardrail',
              messages: buildScopeClassifierMessages(value, history),
              kind: 'guardrail',
              turn,
              ctx,
              usage,
              temperature: 0,
            }),
        });
    if (scope.scope === 'out') {
      await this.guardrails.record({
        userId,
        sessionId: session.id,
        rule: 'rag.scope',
        action: 'refuse',
        score: scope.confidence,
        details: { source: scope.source },
      });
      return this.finish(turn, RAG_COPY.outOfScope, 'ok', [], usage);
    }

    let vector: number[];
    try {
      vector = await this.embedQuestion(retrievalQuery, turn, usage, ctx);
    } catch (error) {
      if (isAbort(error) || ctx.signal.aborted) throw new TurnAbortedError();
      this.logger.warn(`query embedding failed: ${String(error)}`);
      await this.guardrails.record({
        userId,
        sessionId: session.id,
        rule: 'rag.embedding_unavailable',
        action: 'degrade',
      });
      return this.finish(turn, RAG_COPY.unavailable, 'ok', [], usage);
    }

    let chunks: RetrievedChunk[];
    try {
      chunks = await this.retriever.retrieve(vector, settings.topK);
    } catch (error) {
      if (ctx.signal.aborted) throw new TurnAbortedError();
      this.logger.warn(`policy retrieval failed: ${String(error)}`);
      await this.guardrails.record({
        userId,
        sessionId: session.id,
        rule: 'rag.unavailable',
        action: 'degrade',
      });
      return this.finish(turn, RAG_COPY.unavailable, 'ok', [], usage);
    }
    if (ctx.signal.aborted) throw new TurnAbortedError();

    const relevant = chunks.filter(
      (chunk) => Number.isFinite(chunk.distance) && chunk.distance <= settings.maxDistance,
    );
    if (relevant.length === 0) {
      const best = chunks.reduce<number | undefined>(
        (min, chunk) => (min === undefined || chunk.distance < min ? chunk.distance : min),
        undefined,
      );
      await this.guardrails.record({
        userId,
        sessionId: session.id,
        rule: 'rag.no_match',
        action: 'refuse',
        ...(best !== undefined ? { score: best } : {}),
        details: { retrieved: chunks.length, maxDistance: settings.maxDistance },
      });
      return this.finish(turn, RAG_COPY.noMatch, 'ok', [], usage);
    }

    ctx.onProgress?.('generating');
    let rawAnswer: string;
    try {
      rawAnswer = await this.callModel({
        chain: 'rag',
        messages: buildAnswerMessages(retrievalQuery, relevant, settings.maxContextChars),
        kind: 'rag',
        turn,
        ctx,
        usage,
        temperature: settings.temperature,
      });
    } catch (error) {
      if (isAbort(error) || ctx.signal.aborted) throw new TurnAbortedError();
      this.logger.warn(`rag answer failed: ${String(error)}`);
      await this.guardrails.record({
        userId,
        sessionId: session.id,
        rule: 'rag.provider',
        action: 'degrade',
      });
      return this.providerFailure(turn, usage);
    }
    if (ctx.signal.aborted) throw new TurnAbortedError();

    let answer = sanitizeAnswer(rawAnswer, settings.maxAnswerChars);
    const masked = redactPii(answer);
    if (masked.findings.length > 0) {
      await this.guardrails.record({
        userId,
        sessionId: session.id,
        rule: 'pii.output',
        action: 'redact',
        details: {
          findings: masked.findings.map((f) => `${f.kind}:${f.count}`).join(','),
        },
      });
      answer = masked.text;
    }
    if (answer.trim().length === 0) {
      await this.guardrails.record({
        userId,
        sessionId: session.id,
        rule: 'rag.empty_output',
        action: 'degrade',
      });
      return this.providerFailure(turn, usage);
    }

    const redundant = detectRedundancy({
      reply: answer,
      assistantHistory: history
        .filter((entry) => entry.role === 'assistant')
        .map((entry) => entry.content),
      userMessage: question,
      threshold: guardrails.similarity,
    });
    if (redundant.redundant) {
      await this.guardrails.record({
        userId,
        sessionId: session.id,
        rule: redundant.rule,
        action: 'refuse',
        score: redundant.score,
        details: { reason: redundant.reason },
      });
      return this.finish(turn, GUARDRAIL_COPY.redundancy, 'ok', [], usage);
    }

    const sources = sourcesFromChunks(relevant, settings.maxSources);
    // If the grounded model itself refuses, do not attach unrelated sources.
    if (answer.trim() === RAG_COPY.noMatch) {
      return this.finish(turn, RAG_COPY.noMatch, 'ok', [], usage);
    }
    const text = `${answer}${buildSourcesFooter(relevant, settings.maxSources)}`;
    await this.sessions.persistAssistant({
      sessionId: session.id,
      turnId: turn.turnId,
      runId: turn.runId,
      content: text,
      status: 'complete',
      sources,
    });
    return { text, status: 'ok', sources, usage };
  }

  private async callModel(input: {
    chain: string;
    messages: ChatMessage[];
    kind: 'rag' | 'guardrail';
    turn: PreparedTurn;
    ctx: RagRunContext;
    usage: SseUsage;
    temperature: number;
  }): Promise<string> {
    const started = Date.now();
    let result: { content: string; provider: string; model: string };
    try {
      result = await this.gateway.generate({
        chain: input.chain,
        messages: input.messages,
        temperature: input.temperature,
        signal: input.ctx.signal,
      });
    } catch (error) {
      if ((error instanceof GatewayError && error.code === 'ABORTED') || input.ctx.signal.aborted) {
        throw new TurnAbortedError();
      }
      throw error;
    }
    if (input.ctx.signal.aborted) throw new TurnAbortedError();

    const inputTokens = estimateTokens(input.messages.map((message) => message.content).join('\n'));
    const outputTokens = estimateTokens(result.content);
    input.usage.inputTokens += inputTokens;
    input.usage.outputTokens += outputTokens;
    await this.budgets.record({
      userId: input.turn.session.userId,
      sessionId: input.turn.session.id,
      runId: input.turn.runId,
      kind: input.kind,
      model: result.model,
      provider: result.provider,
      inputTokens,
      outputTokens,
      estimated: true,
      latencyMs: Date.now() - started,
    });
    return result.content;
  }

  private async embedQuestion(
    text: string,
    turn: PreparedTurn,
    usage: SseUsage,
    ctx: RagRunContext,
  ): Promise<number[]> {
    const started = Date.now();
    const vector = await this.embedder.embed(text);
    if (ctx.signal.aborted) throw new TurnAbortedError();
    const inputTokens = estimateTokens(text);
    usage.inputTokens += inputTokens;
    await this.budgets.record({
      userId: turn.session.userId,
      sessionId: turn.session.id,
      runId: turn.runId,
      kind: 'embedding',
      model: EMBEDDING.model,
      provider: EMBEDDING.provider,
      inputTokens,
      outputTokens: 0,
      estimated: true,
      latencyMs: Date.now() - started,
    });
    return vector;
  }

  private async providerFailure(turn: PreparedTurn, usage: SseUsage): Promise<RagRunResult> {
    const text = RAG_COPY.providerError;
    await this.sessions.persistAssistant({
      sessionId: turn.session.id,
      turnId: turn.turnId,
      runId: turn.runId,
      content: text,
      status: 'error',
      sources: [],
    });
    return {
      text,
      status: 'error',
      sources: [],
      usage,
      error: { code: 'PROVIDER_UNAVAILABLE', message: text, retryable: true },
    };
  }

  /** Persist a guardrail refusal as an ordinary assistant turn. */
  private async finish(
    turn: PreparedTurn,
    text: string,
    status: 'ok' | 'error',
    sources: ChatSource[],
    usage: SseUsage,
  ): Promise<RagRunResult> {
    await this.sessions.persistAssistant({
      sessionId: turn.session.id,
      turnId: turn.turnId,
      runId: turn.runId,
      content: text,
      status: status === 'ok' ? 'complete' : 'error',
      sources,
    });
    return { text, status, sources, usage };
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof TurnAbortedError;
}

function ragGuardrailEnv(): { threshold: number; similarity: number } {
  try {
    const env = getEnv();
    return {
      threshold: env.JAILBREAK_THRESHOLD,
      similarity: env.REDUNDANCY_SIMILARITY_THRESHOLD,
    };
  } catch {
    const numberOr = (value: string | undefined, fallback: number): number => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    return {
      threshold: numberOr(process.env.JAILBREAK_THRESHOLD, JAILBREAK_POLICY.threshold),
      similarity: numberOr(
        process.env.REDUNDANCY_SIMILARITY_THRESHOLD,
        REDUNDANCY_POLICY.similarityThreshold,
      ),
    };
  }
}
