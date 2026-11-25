import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { CassetteStore } from './cassette.store';
import {
  type Capability,
  CHAINS,
  type ModelEntry,
  PROVIDER_CONFIG,
  type ProviderId,
} from './models.config';

/** A single chat message. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Pluggable transport so tests can inject a fake without any network. */
export type InvokeFn = (args: {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature?: number;
}) => Promise<string>;

export interface GatewayRequest {
  chain: keyof typeof CHAINS | string;
  messages: ChatMessage[];
  /** Require these capabilities from the chosen model. */
  require?: Capability[];
  temperature?: number;
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

const QUOTA_ERROR = /quota|rate.?limit|429|resource.?exhausted|too many requests/i;
const PROVIDER_COOLDOWN_MS = 60_000;
const PROVIDER_BREAK_THRESHOLD = 3;

interface ProviderState {
  consecutiveQuotaErrors: number;
  disabledUntil: number;
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
  ) {
    this.forcedDisabled = new Set(
      (process.env.PROVIDER_DISABLE ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is ProviderId => s === 'groq' || s === 'gemini'),
    );
    for (const p of Object.keys(PROVIDER_CONFIG) as ProviderId[]) {
      this.providers.set(p, { consecutiveQuotaErrors: 0, disabledUntil: 0 });
    }
  }

  /** Resolve the chain, pick the first healthy capable model, invoke with fallback. */
  async generate(req: GatewayRequest): Promise<GatewayResult> {
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

    const started = Date.now();
    let lastError: unknown;

    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i] as ModelEntry;
      try {
        const content = await this.invokeWithTimeout(entry, req);
        this.recordSuccess(entry.provider);
        const elapsedMs = Date.now() - started;
        // Phase 1 acceptance: every served call is logged with provider + model.
        this.logger.log(
          `gateway: chain=${req.chain} provider=${entry.provider} model=${entry.model} attempt=${i + 1} elapsedMs=${elapsedMs}`,
        );
        return {
          content,
          provider: entry.provider,
          model: entry.model,
          attempt: i,
          elapsedMs,
        };
      } catch (err) {
        lastError = err;
        const reason = err instanceof GatewayError ? err.code : 'UPSTREAM_ERROR';
        this.logger.warn(`gateway fallback: ${entry.provider}/${entry.model} failed (${reason})`);
        if (
          err instanceof GatewayError &&
          (err.code === 'NO_MODEL_AVAILABLE' || err.code === 'NO_CASSETTE')
        ) {
          throw err;
        }
        // Quota errors trip the provider breaker; others just fall through.
        if (err instanceof GatewayError && err.code === 'PROVIDER_QUOTA') {
          this.recordQuotaError(entry.provider);
        }
      }
    }

    const message =
      lastError instanceof GatewayError ? lastError.message : 'All models in chain failed';
    throw new GatewayError(message, 'ALL_MODELS_FAILED', 502);
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
    if (state && state.disabledUntil > Date.now()) return false;
    return require.every((c) => model.capabilities.includes(c));
  }

  private async invokeWithTimeout(entry: ModelEntry, req: GatewayRequest): Promise<string> {
    const timeoutMs = Number(process.env.MODEL_TIMEOUT_MS ?? 30_000);

    // Replay mode: serve from cassette before touching any transport.
    // Cassettes only wrap the real transport; an injected test transport
    // (invokeFn) bypasses cassette logic entirely.
    let cassetteKey: string | null = null;
    if (!this.invokeFn) {
      cassetteKey = this.cassettes.key(entry.provider, entry.model, req.chain, req.messages);
      const replayed = this.cassettes.load(cassetteKey);
      if (replayed !== null) return replayed;
      if ((process.env.LLM_MODE ?? 'live') === 'replay') {
        // Never fall through to the network in replay mode (tests need no keys).
        throw new GatewayError(
          `No cassette for ${entry.provider}/${entry.model}`,
          'NO_CASSETTE',
          503,
        );
      }
    }

    const run = async (): Promise<string> => {
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
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const content = await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new GatewayError('Model timed out', 'TIMEOUT', 504)),
            timeoutMs,
          );
        }),
      ]);
      if (cassetteKey !== null) this.cassettes.save(cassetteKey, content);
      return content;
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (QUOTA_ERROR.test(message)) {
        throw new GatewayError(`Provider quota exceeded: ${message}`, 'PROVIDER_QUOTA', 429);
      }
      throw new GatewayError(message, 'UPSTREAM_ERROR', 502);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Default transport built lazily from the pinned LangChain provider packages.
   * Kept as a method so unit tests never load provider SDKs.
   */
  private async defaultInvoke(entry: ModelEntry, req: GatewayRequest): Promise<string> {
    const { ChatGroq } = await import('@langchain/groq');
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');

    const common = {
      maxTokens: entry.maxOutputTokens,
      temperature: req.temperature ?? 0,
    };

    const llm =
      entry.provider === 'groq'
        ? new ChatGroq({
            apiKey: process.env.GROQ_API_KEY,
            model: entry.model,
            ...common,
          })
        : new ChatGoogleGenerativeAI({
            apiKey: process.env.GOOGLE_API_KEY,
            model: entry.model,
            maxOutputTokens: entry.maxOutputTokens,
            temperature: req.temperature ?? 0,
          });

    const messages = req.messages.map((m) => {
      if (m.role === 'system') return new SystemMessage(m.content);
      if (m.role === 'assistant') return new AIMessage(m.content);
      return new HumanMessage(m.content);
    });
    const result = await llm.invoke(messages);
    const text = typeof result.content === 'string' ? result.content : '';
    if (!text) throw new GatewayError('Empty model response', 'UPSTREAM_ERROR', 502);
    return text;
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
