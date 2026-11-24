/**
 * Verified model chains (PLAN §6, §15). Every entry was checked against the
 * provider's live model list on 2026-11-24; `verified_at` is recorded on the
 * config object as required by §18.
 *
 * Adding a model = adding an entry here (no code change elsewhere).
 */

export type ProviderId = 'groq' | 'gemini';
export type Capability = 'tools' | 'json' | 'structured' | 'embedding';

export interface ModelEntry {
  /** Provider id, must exist in PROVIDER_CONFIG. */
  provider: ProviderId;
  /** Provider model id sent on the wire. */
  model: string;
  /** Context window in tokens. */
  contextWindow: number;
  /** Output token cap we request. */
  maxOutputTokens: number;
  capabilities: Capability[];
  /** Models may declare free-tier availability (Gemini flash line). */
  freeTier?: boolean;
}

export interface ChainEntry {
  name: string;
  /** Ordered fallback list; first is primary. */
  models: ModelEntry[];
}

export const VERIFIED_AT = '2026-11-24';

const GROQ_KEY = 'GROQ_API_KEY';
const GOOGLE_KEY = 'GOOGLE_API_KEY';

/** Env var that carries the API key for each provider. */
export const PROVIDER_CONFIG: Record<ProviderId, { keyEnvVar: string; label: string }> = {
  groq: { keyEnvVar: GROQ_KEY, label: 'Groq' },
  gemini: { keyEnvVar: GOOGLE_KEY, label: 'Google Gemini' },
};

const gptOss120b: ModelEntry = {
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  contextWindow: 131_072,
  maxOutputTokens: 8_192,
  capabilities: ['tools', 'json'],
};

const gptOss20b: ModelEntry = {
  provider: 'groq',
  model: 'openai/gpt-oss-20b',
  contextWindow: 131_072,
  maxOutputTokens: 8_192,
  capabilities: ['tools', 'json'],
};

const gemini36Flash: ModelEntry = {
  provider: 'gemini',
  model: 'gemini-3.6-flash',
  contextWindow: 1_048_576,
  maxOutputTokens: 65_536,
  capabilities: ['tools', 'json', 'structured'],
  freeTier: true,
};

const gemini35FlashLite: ModelEntry = {
  provider: 'gemini',
  model: 'gemini-3.5-flash-lite',
  contextWindow: 1_048_576,
  maxOutputTokens: 65_536,
  capabilities: ['tools', 'json', 'structured'],
  freeTier: true,
};

/**
 * Named chains. Order matters: primary first, then fallback.
 * - router/guardrail: small + fast, deterministic JSON output.
 * - agent/rag: strongest tool-calling quality.
 * - summarizer: cheapest that handles long context.
 */
export const CHAINS: Record<string, ChainEntry> = {
  router: { name: 'router', models: [gptOss20b, gemini35FlashLite] },
  guardrail: { name: 'guardrail', models: [gptOss20b, gemini35FlashLite] },
  agent: { name: 'agent', models: [gptOss120b, gemini36Flash] },
  rag: { name: 'rag', models: [gptOss120b, gemini36Flash] },
  summarizer: { name: 'summarizer', models: [gemini36Flash, gptOss120b] },
};

export const EMBEDDING: { provider: ProviderId; model: string; dimensions: number } = {
  provider: 'gemini',
  model: 'gemini-embedding-001',
  dimensions: 768,
};

/** Full gateway config snapshot (served by GET /gateway/config, no secrets). */
export function gatewayConfigSnapshot(): {
  verifiedAt: string;
  llmMode: string;
  chains: Array<{
    name: string;
    models: Array<{
      provider: string;
      model: string;
      contextWindow: number;
      maxOutputTokens: number;
      capabilities: string[];
      freeTier?: boolean;
    }>;
  }>;
  embedding: typeof EMBEDDING;
} {
  return {
    verifiedAt: VERIFIED_AT,
    llmMode: process.env.LLM_MODE ?? 'live',
    chains: Object.values(CHAINS).map((c) => ({
      name: c.name,
      models: c.models.map((m) => ({ ...m })),
    })),
    embedding: { ...EMBEDDING },
  };
}
