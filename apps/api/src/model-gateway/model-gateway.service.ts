import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { tool as langchainTool } from '@langchain/core/tools';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { z } from 'zod';
import { getEnv } from '../config/env';
import { CassetteStore } from './cassette.store';
import {
  type Capability,
  CHAINS,
  type ModelEntry,
  PROVIDER_CONFIG,
  type ProviderId,
} from './models.config';

/** A single chat message. `tool` messages only appear in tool-calling loops. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Assistant tool calls, echoed back to the provider with their results. */
  toolCalls?: GatewayToolCall[];
  /** Tool result correlation id (role `tool`). */
  toolCallId?: string;
  /** Tool name for display/provider compatibility (role `tool`). */
  name?: string;
}

/** A tool the model may call. Arguments are validated by the caller with `schema`. */
export interface ToolSpec {
  name: string;
  description: string;
  schema: z.ZodType;
}

export interface GatewayToolCall {
  id: string;
  name: string;
  args: unknown;
}

/** Usage reported by the provider, or estimated by the gateway/callers. */
export type GatewayUsage = {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
};

export type TextInvokeResult = { content: string; usage?: GatewayUsage };
export type ToolInvokeResult = {
  content: string;
  toolCalls: GatewayToolCall[];
  usage?: GatewayUsage;
};

/** Pluggable tool transport so tests can script model tool calls offline. */
export type ToolInvokeFn = (args: {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  temperature?: number;
}) => Promise<ToolInvokeResult>;

export interface ToolGatewayRequest extends GatewayRequest {
  tools: ToolSpec[];
}

export interface ToolGatewayResult extends GatewayResult {
  toolCalls: GatewayToolCall[];
}

/** Pluggable transport so tests can inject a fake without any network. */
export type InvokeFn = (args: {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature?: number;
}) => Promise<string | TextInvokeResult>;

export interface GatewayRequest {
  chain: keyof typeof CHAINS | string;
  messages: ChatMessage[];
  /** Require these capabilities from the chosen model. */
  require?: Capability[];
  temperature?: number;
  /** Abort an in-flight call (client disconnect / Stop button). */
  signal?: AbortSignal;
  /**
   * Pin a specific provider+model instead of the chain order (used by
   * POST /gateway/test). Still subject to key/breaker checks.
   */
  explicit?: { provider: ProviderId; model: string };
}

export interface GatewayResult {
  content: string;
  provider: ProviderId;
  model: string;
  /** Which chain position served the request (0 = primary). */
  attempt: number;
  elapsedMs: number;
  /** Provider usage when available; otherwise an estimate. */
  usage?: GatewayUsage;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/** Structural surface shared by the pinned provider chat models. */
type ChatInvoker = {
  invoke(
    input: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<{
    content: unknown;
    tool_calls?: Array<{ id?: string; name: string; args?: unknown }>;
    usage_metadata?: { input_tokens?: number; output_tokens?: number };
  }>;
};

type ChatModelLike = ChatInvoker & {
  bindTools?: (tools: unknown[], kwargs?: Record<string, unknown>) => ChatInvoker;
};

const QUOTA_ERROR = /quota|rate.?limit|429|resource.?exhausted|too many requests/i;
const PROVIDER_COOLDOWN_MS = 60_000;
const PROVIDER_BREAK_THRESHOLD = 3;
const RETRYABLE_CODES = new Set(['PROVIDER_QUOTA', 'UPSTREAM_ERROR', 'TIMEOUT']);
const FATAL_CODES = new Set([
  'NO_MODEL_AVAILABLE',
  'NO_CASSETTE',
  'ABORTED',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
]);
const FATAL_STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
};

export const GATEWAY_RETRY_CONFIG = Symbol('GATEWAY_RETRY_CONFIG');

export type GatewayRetryConfig = {
  /** Base delay before the first retry; doubled per attempt. */
  baseMs: number;
  /** Upper bound for the exponential delay (jitter is added on top). */
  maxMs: number;
  jitter: boolean;
};

const DEFAULT_RETRY: GatewayRetryConfig = { baseMs: 100, maxMs: 1_000, jitter: true };

interface ProviderState {
  consecutiveQuotaErrors: number;
  disabledUntil: number;
  /** Reset at UTC midnight; enforces PROVIDER_DAILY_TOKEN_BUDGET (§6). */
  tokensToday: number;
  dayStart: number;
}

/**
 * Model gateway (PLAN §6): capability gate → provider selection → timeout →
 * fallback chain → provider quota breaker → record/replay.
 *
 * Identity never comes from the model: this service only ever receives
 * already-authenticated request context from its callers.
 */
@Injectable()
export class ModelGatewayService {
  private readonly logger = new Logger(ModelGatewayService.name);
  private readonly providers = new Map<ProviderId, ProviderState>();
  private readonly forcedDisabled: Set<ProviderId>;

  constructor(
    private readonly cassettes: CassetteStore,
    @Optional() private readonly invokeFn?: InvokeFn,
    @Optional() private readonly toolInvokeFn?: ToolInvokeFn,
    @Optional()
    @Inject(GATEWAY_RETRY_CONFIG)
    private readonly retry?: GatewayRetryConfig,
  ) {
    this.forcedDisabled = new Set(
      (process.env.PROVIDER_DISABLE ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is ProviderId => s === 'groq' || s === 'gemini'),
    );
    const dayStart = startOfUtcDayMs();
    for (const p of Object.keys(PROVIDER_CONFIG) as ProviderId[]) {
      this.providers.set(p, {
        consecutiveQuotaErrors: 0,
        disabledUntil: 0,
        tokensToday: 0,
        dayStart,
      });
    }
  }

  /** Resolve the chain, pick the first healthy capable model, invoke with fallback. */
  async generate(req: GatewayRequest): Promise<GatewayResult> {
    const candidates = this.candidates(req);
    const started = Date.now();
    let lastError: unknown;

    for (let i = 0; i < candidates.length; i++) {
      if (req.signal?.aborted) {
        throw new GatewayError('Request aborted', 'ABORTED', 499);
      }
      const entry = candidates[i] as ModelEntry;
      try {
        const result = await this.invokeWithTimeout(entry, req);
        this.recordSuccess(entry.provider);
        const usage = result.usage ?? this.estimateUsage(req.messages, result.content);
        this.consumeProviderTokens(entry.provider, usage);
        const elapsedMs = Date.now() - started;
        // Phase 1 acceptance: every served call is logged with provider + model.
        this.logger.log(
          `gateway: chain=${req.chain} provider=${entry.provider} model=${entry.model} attempt=${i + 1} elapsedMs=${elapsedMs}`,
        );
        return {
          content: result.content,
          provider: entry.provider,
          model: entry.model,
          attempt: i,
          elapsedMs,
          usage,
        };
      } catch (err) {
        lastError = err;
        this.logFallback(entry, err);
        this.rethrowFatal(entry, err);
        if (i < candidates.length - 1 && this.isRetryable(err)) {
          await this.backoff(i, req.signal);
        }
      }
    }

    const message =
      lastError instanceof GatewayError ? lastError.message : 'All models in chain failed';
    throw new GatewayError(message, 'ALL_MODELS_FAILED', 502);
  }

  /**
   * Tool-calling variant (PLAN §6/§8): same capability gate, fallback chain,
   * breaker, and record/replay as `generate`, but the model may return tool
   * calls. The caller executes tools and validates arguments.
   */
  async generateWithTools(req: ToolGatewayRequest): Promise<ToolGatewayResult> {
    const candidates = this.candidates({ ...req, require: req.require ?? ['tools'] });
    const started = Date.now();
    let lastError: unknown;

    for (let i = 0; i < candidates.length; i++) {
      if (req.signal?.aborted) {
        throw new GatewayError('Request aborted', 'ABORTED', 499);
      }
      const entry = candidates[i] as ModelEntry;
      try {
        const result = await this.invokeToolsWithTimeout(entry, req);
        this.recordSuccess(entry.provider);
        const output = `${result.content}${JSON.stringify(result.toolCalls)}`;
        const usage = result.usage ?? this.estimateUsage(req.messages, output);
        this.consumeProviderTokens(entry.provider, usage);
        const elapsedMs = Date.now() - started;
        this.logger.log(
          `gateway: chain=${req.chain} provider=${entry.provider} model=${entry.model} tools=${req.tools.length} toolCalls=${result.toolCalls.length} attempt=${i + 1} elapsedMs=${elapsedMs}`,
        );
        return {
          content: result.content,
          toolCalls: result.toolCalls,
          provider: entry.provider,
          model: entry.model,
          attempt: i,
          elapsedMs,
          usage,
        };
      } catch (err) {
        lastError = err;
        this.logFallback(entry, err);
        this.rethrowFatal(entry, err);
        if (i < candidates.length - 1 && this.isRetryable(err)) {
          await this.backoff(i, req.signal);
        }
      }
    }

    const message =
      lastError instanceof GatewayError ? lastError.message : 'All models in chain failed';
    throw new GatewayError(message, 'ALL_MODELS_FAILED', 502);
  }

  private candidates(req: GatewayRequest): ModelEntry[] {
    let candidates: ModelEntry[];

    if (req.explicit) {
      const match = Object.values(CHAINS)
        .flatMap((c) => c.models)
        .find((m) => m.provider === req.explicit?.provider && m.model === req.explicit?.model);
      if (!match) throw new GatewayError('Unknown provider/model', 'BAD_REQUEST', 400);
      if (!this.usable(match, req.require ?? [])) {
        throw new GatewayError('Requested model is not usable', 'NO_MODEL_AVAILABLE', 503);
      }
      candidates = [match];
    } else {
      const chain = CHAINS[req.chain];
      if (!chain) throw new GatewayError(`Unknown chain: ${req.chain}`, 'BAD_REQUEST', 400);
      candidates = chain.models.filter((m) => this.usable(m, req.require ?? []));
    }

    if (candidates.length === 0) {
      throw new GatewayError('No usable model for this chain', 'NO_MODEL_AVAILABLE', 503);
    }
    return candidates;
  }

  private logFallback(entry: ModelEntry, err: unknown): void {
    const reason = err instanceof GatewayError ? err.code : 'UPSTREAM_ERROR';
    this.logger.warn(`gateway fallback: ${entry.provider}/${entry.model} failed (${reason})`);
  }

  /** Never retry fatal conditions on the next provider (PLAN §6). */
  private rethrowFatal(entry: ModelEntry, err: unknown): void {
    if (err instanceof GatewayError && FATAL_CODES.has(err.code)) {
      throw err;
    }
    // Quota errors trip the provider breaker; others just fall through.
    if (err instanceof GatewayError && err.code === 'PROVIDER_QUOTA') {
      this.recordQuotaError(entry.provider);
    }
  }

  /** 429/5xx/timeouts retry the next candidate with capped exponential backoff. */
  private isRetryable(err: unknown): boolean {
    return err instanceof GatewayError && RETRYABLE_CODES.has(err.code);
  }

  private async backoff(attempt: number, signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) throw new GatewayError('Request aborted', 'ABORTED', 499);
    const config = this.retry ?? DEFAULT_RETRY;
    const capped = Math.min(config.maxMs, config.baseMs * 2 ** attempt);
    const delay = config.jitter
      ? capped + Math.floor(Math.random() * Math.max(1, config.baseMs))
      : capped;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    if (signal?.aborted) throw new GatewayError('Request aborted', 'ABORTED', 499);
  }

  /** Health snapshot for /gateway/config — no secrets, no keys. */
  providerHealth(): Array<{ provider: ProviderId; disabled: boolean; reason: string | null }> {
    return (Object.keys(PROVIDER_CONFIG) as ProviderId[]).map((p) => {
      const state = this.providers.get(p);
      const keyEnv = PROVIDER_CONFIG[p].keyEnvVar;
      const hasKey = Boolean(process.env[keyEnv]);
      if (this.forcedDisabled.has(p))
        return { provider: p, disabled: true, reason: 'PROVIDER_DISABLE' };
      if (!hasKey) return { provider: p, disabled: true, reason: 'missing key' };
      if (state && state.disabledUntil > Date.now()) {
        return { provider: p, disabled: true, reason: 'quota cooldown' };
      }
      return { provider: p, disabled: false, reason: null };
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private usable(model: ModelEntry, require: Capability[]): boolean {
    if (this.forcedDisabled.has(model.provider)) return false;
    if (!process.env[PROVIDER_CONFIG[model.provider].keyEnvVar]) return false;
    const state = this.providers.get(model.provider);
    if (state) {
      this.rolloverProviderDay(state);
      if (state.disabledUntil > Date.now()) return false;
      if (state.tokensToday >= this.dailyBudget()) return false;
    }
    return require.every((c) => model.capabilities.includes(c));
  }

  private dailyBudget(): number {
    const fromEnv = Number(process.env.PROVIDER_DAILY_TOKEN_BUDGET);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
    try {
      return getEnv().PROVIDER_DAILY_TOKEN_BUDGET;
    } catch {
      return 1_000_000;
    }
  }

  private rolloverProviderDay(state: ProviderState): void {
    const dayStart = startOfUtcDayMs();
    if (state.dayStart !== dayStart) {
      state.dayStart = dayStart;
      state.tokensToday = 0;
      state.consecutiveQuotaErrors = 0;
    }
  }

  private consumeProviderTokens(provider: ProviderId, usage: GatewayUsage): void {
    const state = this.providers.get(provider);
    if (!state) return;
    this.rolloverProviderDay(state);
    state.tokensToday += Math.max(0, usage.inputTokens + usage.outputTokens);
  }

  private estimateUsage(messages: ChatMessage[], output: string): GatewayUsage {
    const input = messages.reduce((sum, message) => {
      const toolArgs = message.toolCalls ? JSON.stringify(message.toolCalls) : '';
      return sum + message.content.length + toolArgs.length;
    }, 0);
    return {
      inputTokens: Math.ceil(input / 4),
      outputTokens: Math.ceil(output.length / 4),
      estimated: true,
    };
  }

  private async invokeWithTimeout(
    entry: ModelEntry,
    req: GatewayRequest,
  ): Promise<TextInvokeResult> {
    if (req.signal?.aborted) {
      throw new GatewayError('Model call aborted', 'ABORTED', 499);
    }

    // Replay mode: serve from cassette before touching any transport.
    // Cassettes only wrap the real transport; an injected test transport
    // (invokeFn) bypasses cassette logic entirely.
    let cassetteKey: string | null = null;
    if (!this.invokeFn) {
      cassetteKey = this.cassettes.key(entry.provider, entry.model, req.chain, req.messages);
      const replayed = this.cassettes.load(cassetteKey);
      if (replayed !== null) {
        return { content: replayed, usage: this.estimateUsage(req.messages, replayed) };
      }
      if ((process.env.LLM_MODE ?? 'live') === 'replay') {
        // Never fall through to the network in replay mode (tests need no keys).
        throw new GatewayError(
          `No cassette for ${entry.provider}/${entry.model}`,
          'NO_CASSETTE',
          503,
        );
      }
    }

    const raw = await this.raceWithTimeout(async () => {
      if (this.invokeFn) {
        return this.invokeFn({
          provider: entry.provider,
          model: entry.model,
          messages: req.messages,
          maxOutputTokens: entry.maxOutputTokens,
          temperature: req.temperature,
        });
      }
      return this.defaultInvoke(entry, req);
    }, req.signal);
    const result = normalizeTextResult(raw);
    if (cassetteKey !== null) this.cassettes.save(cassetteKey, result.content);
    return result;
  }

  private async invokeToolsWithTimeout(
    entry: ModelEntry,
    req: ToolGatewayRequest,
  ): Promise<ToolInvokeResult> {
    if (req.signal?.aborted) {
      throw new GatewayError('Model call aborted', 'ABORTED', 499);
    }

    let cassetteKey: string | null = null;
    if (!this.toolInvokeFn) {
      // Tool schema is part of the key (PLAN §6): the same prompt with a
      // different toolset must not replay an incompatible response.
      cassetteKey = this.cassettes.key(
        entry.provider,
        entry.model,
        req.chain,
        req.messages,
        toolSchemaFingerprint(req.tools),
      );
      const replayed = this.cassettes.loadJson(cassetteKey);
      const parsed = parseToolCassette(replayed);
      if (parsed) {
        return {
          ...parsed,
          usage: this.estimateUsage(
            req.messages,
            `${parsed.content}${JSON.stringify(parsed.toolCalls)}`,
          ),
        };
      }
      if ((process.env.LLM_MODE ?? 'live') === 'replay') {
        throw new GatewayError(
          `No cassette for ${entry.provider}/${entry.model}`,
          'NO_CASSETTE',
          503,
        );
      }
    }

    const result = await this.raceWithTimeout(async () => {
      if (this.toolInvokeFn) {
        return this.toolInvokeFn({
          provider: entry.provider,
          model: entry.model,
          messages: req.messages,
          tools: req.tools,
          maxOutputTokens: entry.maxOutputTokens,
          temperature: req.temperature,
        });
      }
      return this.defaultInvokeTools(entry, req);
    }, req.signal);

    // Normalize injected transports too: some providers return JSON-string args
    // or omit call ids, and downstream tools need a stable shape.
    const normalized: ToolInvokeResult = {
      content: result.content,
      toolCalls: normalizeToolCalls(
        result.toolCalls as Array<{ id?: string; name: string; args?: unknown }>,
      ),
      ...(result.usage ? { usage: result.usage } : {}),
    };
    if (cassetteKey !== null) this.cassettes.saveJson(cassetteKey, normalized);
    return normalized;
  }

  private async raceWithTimeout<T>(
    run: () => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const timeoutMs = Number(process.env.MODEL_TIMEOUT_MS ?? 30_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new GatewayError('Model call aborted', 'ABORTED', 499));
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new GatewayError('Model timed out', 'TIMEOUT', 504)),
            timeoutMs,
          );
        }),
        aborted,
      ]);
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const status = providerStatus(err);
      const fatalCode = status ? FATAL_STATUS_CODES[status] : undefined;
      if (fatalCode && status) {
        // 400/401/403 are caller/provider configuration errors: never retry.
        throw new GatewayError(`Provider rejected the request (${status})`, fatalCode, status);
      }
      const message = err instanceof Error ? err.message : String(err);
      if (QUOTA_ERROR.test(message) || status === 429) {
        throw new GatewayError(`Provider quota exceeded: ${message}`, 'PROVIDER_QUOTA', 429);
      }
      throw new GatewayError(message, 'UPSTREAM_ERROR', 502);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Default transport built lazily from the pinned LangChain provider packages.
   * Kept as a method so unit tests never load provider SDKs.
   */
  private async defaultInvoke(entry: ModelEntry, req: GatewayRequest): Promise<TextInvokeResult> {
    const llm = await this.buildChatModel(entry, req.temperature);
    const result = await llm.invoke(toLangChainMessages(req.messages), { signal: req.signal });
    const text = typeof result.content === 'string' ? result.content : '';
    if (!text) throw new GatewayError('Empty model response', 'UPSTREAM_ERROR', 502);
    return { content: text, ...usageFromMetadata(result.usage_metadata) };
  }

  private async defaultInvokeTools(
    entry: ModelEntry,
    req: ToolGatewayRequest,
  ): Promise<ToolInvokeResult> {
    const llm = await this.buildChatModel(entry, req.temperature);
    if (!llm.bindTools) {
      throw new GatewayError('Model does not support tool calling', 'NO_MODEL_AVAILABLE', 503);
    }
    const bound = llm.bindTools(
      req.tools.map((spec) =>
        langchainTool(async () => '', {
          name: spec.name,
          description: spec.description,
          schema: spec.schema,
        }),
      ),
    );
    const result = await bound.invoke(toLangChainMessages(req.messages), {
      signal: req.signal,
    });
    const content = typeof result.content === 'string' ? result.content : '';
    const toolCalls = normalizeToolCalls(result.tool_calls);
    if (!content && toolCalls.length === 0) {
      throw new GatewayError('Empty model response', 'UPSTREAM_ERROR', 502);
    }
    return { content, toolCalls, ...usageFromMetadata(result.usage_metadata) };
  }

  private async buildChatModel(
    entry: ModelEntry,
    temperature: number | undefined,
  ): Promise<ChatModelLike> {
    const { ChatGroq } = await import('@langchain/groq');
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    const effectiveTemperature = temperature ?? entry.temperature;

    if (entry.provider === 'groq') {
      return new ChatGroq({
        apiKey: process.env.GROQ_API_KEY,
        model: entry.model,
        maxTokens: entry.maxOutputTokens,
        temperature: effectiveTemperature,
      }) as unknown as ChatModelLike;
    }
    return new ChatGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_API_KEY,
      model: entry.model,
      maxOutputTokens: entry.maxOutputTokens,
      temperature: effectiveTemperature,
    }) as unknown as ChatModelLike;
  }

  private recordQuotaError(provider: ProviderId): void {
    const state = this.providers.get(provider);
    if (!state) return;
    state.consecutiveQuotaErrors += 1;
    if (state.consecutiveQuotaErrors >= PROVIDER_BREAK_THRESHOLD) {
      state.disabledUntil = Date.now() + PROVIDER_COOLDOWN_MS;
      this.logger.warn(
        `provider breaker: ${provider} disabled for ${PROVIDER_COOLDOWN_MS}ms after ${state.consecutiveQuotaErrors} quota errors`,
      );
    }
  }

  private recordSuccess(provider: ProviderId): void {
    const state = this.providers.get(provider);
    if (state) state.consecutiveQuotaErrors = 0;
  }
}

function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (message.role === 'system') return new SystemMessage(message.content);
    if (message.role === 'tool') {
      return new ToolMessage(message.content, message.toolCallId ?? '', message.name);
    }
    if (message.role === 'assistant') {
      if (message.toolCalls && message.toolCalls.length > 0) {
        return new AIMessage({
          content: message.content,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            name: call.name,
            args: normalizeToolArgs(call.args) as Record<string, unknown>,
            type: 'tool_call' as const,
          })),
        });
      }
      return new AIMessage(message.content);
    }
    return new HumanMessage(message.content);
  });
}

function startOfUtcDayMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Provider SDKs expose the HTTP status under different property names. */
function providerStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  return typeof candidate === 'number' && Number.isInteger(candidate) ? candidate : undefined;
}

function usageFromMetadata(
  metadata: { input_tokens?: number; output_tokens?: number } | undefined,
): { usage: GatewayUsage } | Record<string, never> {
  if (!metadata) return {};
  const inputTokens = Number(metadata.input_tokens);
  const outputTokens = Number(metadata.output_tokens);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return {};
  return {
    usage: {
      inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
      outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
      estimated: false,
    },
  };
}

function normalizeTextResult(raw: string | TextInvokeResult): TextInvokeResult {
  return typeof raw === 'string' ? { content: raw } : raw;
}

/** Stable zod-schema fingerprint for cassette keys (PLAN §6/§17). */
function toolSchemaFingerprint(tools: ToolSpec[]): unknown[] {
  return tools.map((spec) => {
    try {
      return { name: spec.name, schema: z.toJSONSchema(spec.schema) };
    } catch {
      return { name: spec.name, schema: spec.schema.toString() };
    }
  });
}

function normalizeToolCalls(
  calls: Array<{ id?: string; name: string; args?: unknown }> | undefined,
): GatewayToolCall[] {
  return (calls ?? [])
    .filter((call) => typeof call.name === 'string' && call.name.length > 0)
    .map((call, index) => ({
      id: call.id ?? `call_${index + 1}`,
      name: call.name,
      args: normalizeToolArgs(call.args),
    }));
}

function normalizeToolArgs(args: unknown): unknown {
  if (typeof args === 'string') {
    try {
      return JSON.parse(args) as unknown;
    } catch {
      return {};
    }
  }
  return args ?? {};
}

function parseToolCassette(
  value: unknown,
): { content: string; toolCalls: GatewayToolCall[] } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { content?: unknown; toolCalls?: unknown };
  if (typeof record.content !== 'string' || !Array.isArray(record.toolCalls)) return null;
  const toolCalls = normalizeToolCalls(record.toolCalls as Array<{ id?: string; name: string }>);
  return { content: record.content, toolCalls };
}
