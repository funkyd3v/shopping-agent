import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Cassette store for `LLM_MODE=record|replay` (PLAN §4/§6/§17). Keys include
 * role and tool-schema fingerprint so the same prompt with a different toolset
 * cannot replay an incompatible response. Only synthetic, PII-free cassettes
 * may be committed; recording writes to `evals/cassettes/` by default.
 */
@Injectable()
export class CassetteStore {
  private readonly logger = new Logger(CassetteStore.name);
  private readonly dir: string;
  private readonly replay: boolean;
  private readonly enabled: boolean;

  constructor() {
    // Works from the repo root (`pnpm eval:*`) and from apps/api (`vitest`).
    const cwd = process.cwd();
    const root = existsSync(join(cwd, 'pnpm-workspace.yaml')) ? cwd : join(cwd, '..', '..');
    this.dir = process.env.CASSETTE_DIR
      ? resolve(process.env.CASSETTE_DIR)
      : join(root, 'evals', 'cassettes');
    const mode = process.env.LLM_MODE ?? 'live';
    this.replay = mode === 'replay';
    this.enabled = this.replay || mode === 'record';
  }

  key(
    provider: string,
    model: string,
    role: string,
    messages: unknown,
    tools: unknown[] = [],
  ): string {
    const canonical = JSON.stringify({ provider, model, role, messages, tools });
    return createHash('sha256').update(canonical).digest('hex');
  }

  load(key: string): string | null {
    const data = this.loadJson(key);
    if (!data || typeof data !== 'object') return null;
    const content = (data as { content?: unknown }).content;
    return typeof content === 'string' ? content : null;
  }

  save(key: string, content: string): void {
    this.saveJson(key, { content });
  }

  /** Tool-calling cassettes keep both text and normalized tool calls. */
  loadJson(key: string): unknown | null {
    // Record mode must never serve stale fixtures: it only writes them.
    if (!this.replay) return null;
    const file = join(this.dir, `${key}.json`);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as unknown;
    } catch {
      return null;
    }
  }

  saveJson(key: string, value: unknown): void {
    if (!this.enabled) return;
    const file = join(this.dir, `${key}.json`);
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify(
          { ...(value as Record<string, unknown>), savedAt: new Date().toISOString() },
          null,
          2,
        ),
      );
    } catch (err) {
      this.logger.warn(`Failed to write cassette ${key}: ${String(err)}`);
    }
  }
}
