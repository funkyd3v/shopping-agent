import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ChatRequest, ErrorCode, SseUsage } from '@shopping-agent/shared';
import { ChatSessionService, type PreparedTurn } from '../chat/chat-session.service';
import { isTurnAborted, TurnAbortedError } from '../common/turn-abort';
import { getEnv } from '../config/env';
import { GuardrailService } from '../guardrails/guardrail.service';
import {
  GUARDRAIL_COPY,
  JAILBREAK_POLICY,
  REDUNDANCY_POLICY,
} from '../guardrails/guardrails.policy';
import { type Classifier, classifyJailbreak, hasSideEffectIntent } from '../guardrails/jailbreak';
import { redactPii } from '../guardrails/pii';
import { detectRedundancy } from '../guardrails/redundancy';
import {
  BudgetExhaustedError,
  estimateTokens,
  TokenBudgetService,
} from '../guardrails/token-budget.service';
import {
  type ChatMessage,
  GatewayError,
  ModelGatewayService,
  type ToolSpec,
} from '../model-gateway/model-gateway.service';
import { sanitizeAnswer } from '../rag/prompt';
import { AGENT_CHECKPOINTER } from './agent.checkpointer';
import { buildAgentFooter } from './agent.footer';
import { runAgentGraph } from './agent.graph';
import { linkifyProductPaths } from './agent.links';
import {
  AGENT_COPY,
  AGENT_POLICY,
  AGENT_PROMPT_VERSIONS,
  type AgentPolicy,
  type AgentTuning,
} from './agent.policy';
import { AgentToolRegistry } from './agent.tools';
import type { AgentRoute, ToolCallRecord } from './agent.types';
import { AgentRunService } from './agent-run.service';

export const AGENT_TUNING = Symbol('AGENT_TUNING');

export type AgentRunContext = {
  signal: AbortSignal;
  onProgress?: (phase: 'thinking' | 'generating') => void;
};

export type AgentRunResult = {
  text: string;
  status: 'ok' | 'error';
  usage: SseUsage;
  route: AgentRoute;
  model: string;
  provider: string;
  promptVersion: string;
  toolCalls: ToolCallRecord[];
  error?: { code: ErrorCode; message: string; retryable: boolean };
};

/**
 * `/agent/chat` pipeline (PLAN §8): input guardrails → budget → LangGraph
 * router/specialist → output guardrails → server footer → persist → stream.
 * The graph never receives identity from the model; tools are read-only.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly gateway: ModelGatewayService,
    private readonly sessions: ChatSessionService,
    private readonly guardrails: GuardrailService,
    private readonly budgets: TokenBudgetService,
    private readonly tools: AgentToolRegistry,
    private readonly runs: AgentRunService,
    @Optional() @Inject(AGENT_CHECKPOINTER) private readonly checkpointer?: BaseCheckpointSaver,
    @Optional() @Inject(AGENT_TUNING) private readonly tuning?: AgentTuning,
  ) {}

  begin(userId: string, request: ChatRequest): Promise<PreparedTurn> {
    return this.sessions.beginTurn({
      userId,
      kind: 'agent',
      sessionId: request.sessionId,
      clientMessageId: request.clientMessageId,
      message: request.message,
    });
  }

  async run(turn: PreparedTurn, ctx: AgentRunContext): Promise<AgentRunResult> {
    const policy: AgentPolicy = { ...AGENT_POLICY, ...this.tuning };
    const usage: SseUsage = { inputTokens: 0, outputTokens: 0, estimated: true };
    const { session, userMessage } = turn;
    const userId = session.userId;
    const started = Date.now();

    let route: AgentRoute = 'clarify';
    let model = '';
    let provider = '';
    let promptVersion: string = AGENT_PROMPT_VERSIONS.clarify;
    let toolCalls: ToolCallRecord[] = [];
    let runStatus: 'ok' | 'error' | 'blocked' | 'limit' = 'ok';
    let errorCode: string | undefined;

    try {
      const redaction = redactPii(userMessage.content);
      await this.sessions.updateUserModelContent(userMessage.id, redaction.text);
      if (redaction.findings.length > 0) {
        await this.guardrails.record({
          userId,
          sessionId: session.id,
          rule: 'pii.input',
          action: 'redact',
          details: {
            findings: redaction.findings
              .map((finding) => `${finding.kind}:${finding.count}`)
              .join(','),
          },
        });
      }
      const message = redaction.text;
      const settings = guardrailEnv();

      // Jailbreak middleware runs before the graph/router (PLAN §10.2 #3).
      const history = await this.sessions.loadRecentTurns(
        session.id,
        userMessage.seq,
        Math.max(policy.routerHistoryMessages, policy.specialistHistoryMessages),
      );
      const jailbreak = await this.checkJailbreak(
        message,
        history,
        userId,
        session.id,
        ctx,
        settings,
      );
      if (jailbreak.blocked) {
        await this.guardrails.record({
          userId,
          sessionId: session.id,
          rule: 'jailbreak',
          action: 'refuse',
          score: jailbreak.score,
          details: {
            reasons: jailbreak.reasons.join(','),
            category: jailbreak.category,
            source: jailbreak.source,
          },
        });
        runStatus = 'blocked';
        errorCode = 'JAILBREAK_BLOCKED';
        return this.finish(turn, GUARDRAIL_COPY.jailbreakBlocked, 'ok', usage, {
          route,
          model,
          provider,
          promptVersion,
          toolCalls,
        });
      }

      try {
        await this.budgets.assertAvailable({
          userId,
          sessionId: session.id,
          estimatedRequestTokens: estimateTokens(message) + policy.reservedPromptTokens,
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
          runStatus = 'limit';
          errorCode = 'BUDGET_EXHAUSTED';
          return this.finish(turn, AGENT_COPY.budgetExhausted, 'ok', usage, {
            route,
            model,
            provider,
            promptVersion,
            toolCalls,
          });
        }
        throw error;
      }

      let lastModel = '';
      let lastProvider = '';
      const output = await runAgentGraph(
        {
          userId,
          sessionId: session.id,
          turnId: turn.turnId,
          clientMessageId: turn.userMessage.clientMessageId ?? '',
          message,
          recentMessages: history,
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
        },
        {
          policy,
          tools: this.tools,
          modelCall: async (input) => {
            const result = await this.callModel({
              ...input,
              turn,
              ctx,
              usage,
            });
            lastModel = result.model;
            lastProvider = result.provider;
            return result;
          },
        },
        {
          ...(this.checkpointer ? { checkpointer: this.checkpointer } : {}),
          signal: ctx.signal,
        },
      );

      route = output.route;
      model = output.model || lastModel;
      provider = output.provider || lastProvider;
      promptVersion = output.promptVersion;
      toolCalls = output.toolCalls;
      if (output.toolCalls.some((call) => call.errorCode === 'TOOL_LIMIT')) {
        runStatus = 'limit';
        errorCode = 'TOOL_LIMIT';
      }
      if (output.flaggedToolOutputs > 0) {
        await this.guardrails.record({
          userId,
          sessionId: session.id,
          rule: 'agent.tool_output',
          action: 'redact',
          details: { flagged: output.flaggedToolOutputs },
        });
      }
      // Resolver/tool refusals are guardrail actions too (PLAN §10.3/§18).
      for (const call of toolCalls) {
        if (call.ok || !call.errorCode) continue;
        await this.guardrails.record({
          userId,
          sessionId: session.id,
          rule: `agent.tool.${call.errorCode}`,
          action: 'refuse',
          details: { tool: call.name },
        });
      }

      ctx.onProgress?.('generating');
      // Output order (PLAN §10.2): PII mask → redundancy → output format.
      let answer = output.reply;
      const masked = redactPii(answer);
      if (masked.findings.length > 0) {
        await this.guardrails.record({
          userId,
          sessionId: session.id,
          rule: 'pii.output',
          action: 'redact',
          details: {
            findings: masked.findings
              .map((finding) => `${finding.kind}:${finding.count}`)
              .join(','),
          },
        });
        answer = masked.text;
      }
      const redundant = detectRedundancy({
        reply: answer,
        assistantHistory: history
          .filter((entry) => entry.role === 'assistant')
          .map((entry) => entry.content),
        toolCalls,
        userMessage: message,
        threshold: settings.similarity,
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
        runStatus = 'blocked';
        return this.finish(turn, GUARDRAIL_COPY.redundancy, 'ok', usage, {
          route,
          model,
          provider,
          promptVersion,
          toolCalls,
        });
      }

      // Output format is last: sanitize the already-guarded answer, not raw text.
      answer = sanitizeAnswer(answer, policy.maxReplyChars);
      // Never render a bare `/products/:id` in the transcript: use the product
      // name as the link text, falling back to the products known this turn.
      answer = linkifyProductPaths(answer, [...output.productFooter, ...output.lastListedProducts]);
      if (answer.trim().length === 0) {
        runStatus = 'error';
        errorCode = 'EMPTY_OUTPUT';
        await this.guardrails.record({
          userId,
          sessionId: session.id,
          rule: 'agent.empty_output',
          action: 'degrade',
        });
        return this.providerFailure(turn, usage, {
          route,
          model,
          provider,
          promptVersion,
          toolCalls,
        });
      }

      const text = `${answer}${buildAgentFooter(
        output.productFooter,
        output.orderFooter,
        output.cartFooter,
      )}`;
      await this.sessions.persistAssistant({
        sessionId: session.id,
        turnId: turn.turnId,
        runId: turn.runId,
        content: text,
        status: 'complete',
        sources: [],
      });

      return {
        text,
        status: 'ok',
        usage,
        route,
        model,
        provider,
        promptVersion,
        toolCalls,
      };
    } catch (error) {
      if (isTurnAborted(error) || ctx.signal.aborted) {
        runStatus = 'error';
        errorCode = 'ABORTED';
        throw new TurnAbortedError();
      }
      this.logger.warn(
        `agent run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      runStatus = 'error';
      errorCode = 'AGENT_FAILED';
      return this.providerFailure(turn, usage, {
        route,
        model,
        provider,
        promptVersion,
        toolCalls,
      });
    } finally {
      await this.runs.record({
        sessionId: session.id,
        turnId: turn.turnId,
        clientMessageId: turn.userMessage.clientMessageId ?? '',
        agent: route,
        route,
        model,
        provider,
        promptVersion,
        toolCalls,
        durationMs: Date.now() - started,
        status: runStatus,
        ...(errorCode ? { errorCode } : {}),
      });
    }
  }

  /** Heuristic always runs; the optional model classifier only sees gray-zone text. */
  private async checkJailbreak(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    userId: string,
    sessionId: string,
    ctx: AgentRunContext,
    settings: GuardrailSettings,
  ): Promise<Awaited<ReturnType<typeof classifyJailbreak>>> {
    let classify: Classifier | undefined;
    if (settings.live) {
      classify = async (messages) => {
        const served = await this.gateway.generate({
          chain: 'guardrail',
          messages,
          require: ['json'],
          temperature: 0,
          signal: ctx.signal,
        });
        return served.content;
      };
    }
    const verdict = await classifyJailbreak({
      message,
      history,
      toolOutputs: [],
      sideEffects: hasSideEffectIntent(message),
      threshold: settings.threshold,
      classify,
    });
    if (verdict.source === 'degraded') {
      await this.guardrails.record({
        userId,
        sessionId,
        rule: verdict.blocked ? 'jailbreak' : 'jailbreak.degraded',
        action: verdict.blocked ? 'refuse' : 'degrade',
        score: verdict.score,
        details: { reasons: verdict.reasons.join(','), source: 'degraded' },
      });
    }
    return verdict;
  }

  private async callModel(input: {
    chain: 'router' | 'agent';
    messages: ChatMessage[];
    tools?: ToolSpec[];
    temperature: number;
    turn: PreparedTurn;
    ctx: AgentRunContext;
    usage: SseUsage;
  }): Promise<{
    content: string;
    toolCalls: Array<{ id: string; name: string; args: unknown }>;
    provider: string;
    model: string;
  }> {
    const started = Date.now();
    let result: {
      content: string;
      toolCalls: Array<{ id: string; name: string; args: unknown }>;
      provider: string;
      model: string;
      usage?: { inputTokens: number; outputTokens: number; estimated: boolean };
    };

    try {
      if (input.tools && input.tools.length > 0) {
        const served = await this.gateway.generateWithTools({
          chain: input.chain,
          messages: input.messages,
          tools: input.tools,
          require: ['tools'],
          temperature: input.temperature,
          signal: input.ctx.signal,
        });
        result = {
          content: served.content,
          toolCalls: served.toolCalls,
          provider: served.provider,
          model: served.model,
          usage: served.usage,
        };
      } else {
        const served = await this.gateway.generate({
          chain: input.chain,
          messages: input.messages,
          require: input.chain === 'router' ? ['json'] : undefined,
          temperature: input.temperature,
          signal: input.ctx.signal,
        });
        result = {
          content: served.content,
          toolCalls: [],
          provider: served.provider,
          model: served.model,
          usage: served.usage,
        };
      }
    } catch (error) {
      if ((error instanceof GatewayError && error.code === 'ABORTED') || input.ctx.signal.aborted) {
        throw new TurnAbortedError();
      }
      throw error;
    }
    if (input.ctx.signal.aborted) throw new TurnAbortedError();

    const estimatedInput = estimateTokens(
      input.messages.map((message) => message.content).join('\n'),
    );
    const estimatedOutput = estimateTokens(`${result.content}${JSON.stringify(result.toolCalls)}`);
    const usage = result.usage ?? {
      inputTokens: estimatedInput,
      outputTokens: estimatedOutput,
      estimated: true,
    };
    const firstCall = input.usage.inputTokens === 0 && input.usage.outputTokens === 0;
    input.usage.estimated = firstCall ? usage.estimated : input.usage.estimated || usage.estimated;
    input.usage.inputTokens += usage.inputTokens;
    input.usage.outputTokens += usage.outputTokens;
    await this.budgets.record({
      userId: input.turn.session.userId,
      sessionId: input.turn.session.id,
      runId: input.turn.runId,
      kind: input.chain === 'router' ? 'router' : 'agent',
      model: result.model,
      provider: result.provider,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimated: usage.estimated,
      latencyMs: Date.now() - started,
    });
    return result;
  }

  private async providerFailure(
    turn: PreparedTurn,
    usage: SseUsage,
    meta: {
      route: AgentRoute;
      model: string;
      provider: string;
      promptVersion: string;
      toolCalls: ToolCallRecord[];
    },
  ): Promise<AgentRunResult> {
    const text = AGENT_COPY.providerError;
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
      usage,
      ...meta,
      error: { code: 'PROVIDER_UNAVAILABLE', message: text, retryable: true },
    };
  }

  private async finish(
    turn: PreparedTurn,
    text: string,
    status: 'ok' | 'error',
    usage: SseUsage,
    meta: {
      route: AgentRoute;
      model: string;
      provider: string;
      promptVersion: string;
      toolCalls: ToolCallRecord[];
    },
  ): Promise<AgentRunResult> {
    await this.sessions.persistAssistant({
      sessionId: turn.session.id,
      turnId: turn.turnId,
      runId: turn.runId,
      content: text,
      status: status === 'ok' ? 'complete' : 'error',
      sources: [],
    });
    return { text, status, usage, ...meta };
  }
}

type GuardrailSettings = {
  threshold: number;
  similarity: number;
  live: boolean;
};

/** Env overrides are validated at startup; tests may not boot ConfigModule. */
function guardrailEnv(): GuardrailSettings {
  try {
    const env = getEnv();
    return {
      threshold: env.JAILBREAK_THRESHOLD,
      similarity: env.REDUNDANCY_SIMILARITY_THRESHOLD,
      live: env.JAILBREAK_LIVE_CLASSIFIER,
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
      live: process.env.JAILBREAK_LIVE_CLASSIFIER === 'true',
    };
  }
}
