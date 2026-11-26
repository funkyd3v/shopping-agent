import { z } from 'zod';

/**
 * Environment schema (PLAN §15). `guardrails.policy.ts` (Phase 7) is the source of
 * truth for guardrail defaults; this file validates env overrides at startup.
 * Missing/invalid required env FAILS FAST with a readable message.
 */

const boolish = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return defaultValue;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(s)) return true;
      if (['false', '0', 'no', 'off'].includes(s)) return false;
    }
    return v;
  }, z.boolean());

const int = (defaultValue: number, min: number, max?: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? defaultValue : v),
    max === undefined
      ? z.coerce.number().int().min(min)
      : z.coerce.number().int().min(min).max(max),
  );

const float = (defaultValue: number, min: number, max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? defaultValue : v),
    z.coerce.number().min(min).max(max),
  );

const optionalKey = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
  z.string().min(1).optional(),
);

const emptyToDefault = (defaultValue: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : defaultValue),
    z.string(),
  );

export const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(3001, 1),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PROMPTS: boolish(false),

  // Auth (required — fail fast)
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters (generate: openssl rand -hex 32)'),
  COOKIE_SECURE: boolish(false),

  // LLM providers
  GROQ_API_KEY: optionalKey,
  CEREBRAS_API_KEY: optionalKey,
  GOOGLE_API_KEY: optionalKey,
  OPENROUTER_API_KEY: optionalKey,
  LLM_MODE: z.enum(['live', 'record', 'replay']).default('live'),
  PROVIDER_DISABLE: emptyToDefault(''),
  PROVIDER_DAILY_TOKEN_BUDGET: int(1_000_000, 1),

  // Chroma / embeddings
  CHROMA_URL: z.url().default('http://localhost:8000'),
  CHROMA_COLLECTION: z.string().min(1).default('store_policies'),
  EMBEDDING_PROVIDER: z.enum(['gemini', 'local']).default('gemini'),
  EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),
  EMBEDDING_DIM: int(768, 1),

  // RAG retrieval (PLAN §7). Distance is cosine distance: lower is better.
  RAG_TOP_K: int(5, 1, 10),
  RAG_MAX_DISTANCE: float(0.38, 0, 2),

  // Read-only agent limits (PLAN §8). Defaults mirror agent.policy.ts.
  AGENT_MAX_MODEL_CALLS: int(6, 1, 12),
  AGENT_MAX_TOOL_CALLS: int(4, 1, 10),
  AGENT_ROUTER_MIN_CONFIDENCE: float(0.55, 0, 1),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (e.g. file:./data/app.db)'),
  CHECKPOINT_DATABASE_PATH: z.string().min(1).default('./data/checkpoints.db'),

  // Order/cart limits (env overrides for guardrails.policy.ts)
  MAX_ORDER_USD: int(200, 1),
  MAX_QTY_PER_ITEM: int(5, 1),
  MAX_AGENT_ORDERS_PER_DAY: int(5, 1),
  MAX_AGENT_SPEND_PER_DAY_USD: int(500, 1),
  CANCEL_WINDOW_MINUTES: int(30, 1),
  MAX_CART_LINES: int(20, 1),

  // Token budgets
  REQUEST_TOKEN_BUDGET: int(16_000, 1),
  SESSION_TOKEN_BUDGET: int(150_000, 1),
  DAILY_TOKEN_BUDGET: int(500_000, 1),

  // Streaming/input
  STREAM_MODE: z.enum(['buffered', 'holdback']).default('buffered'),
  MAX_MESSAGE_CHARS: int(2000, 1),

  // Rate limits (requests/minute)
  RATE_LIMIT_AUTH: int(10, 1),
  RATE_LIMIT_CHAT: int(20, 1),
  RATE_LIMIT_CART: int(60, 1),
  RATE_LIMIT_CHECKOUT: int(10, 1),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}\nFix .env (see .env.example).`);
  }
  cached = result.data;
  return cached;
}

/** Validated env (set by ConfigModule at startup). Throws if not initialized. */
export function getEnv(): Env {
  if (!cached) throw new Error('Environment not validated yet — ConfigModule has not initialized.');
  return cached;
}
