import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Cassette store for LLM_MODE=replay (PLAN §15/§18: tests never hit the
 * network). Cassettes are keyed by sha256(provider|model|mode|messages).
 */
@Injectable()
export class CassetteStore {
  private readonly logger = new Logger(CassetteStore.name);
  private readonly dir: string;
  private readonly enabled: boolean;

  constructor() {
    this.dir = join(process.cwd(), 'cassettes');
    this.enabled = (process.env.LLM_MODE ?? 'live') === 'replay';
  }

  key(provider: string, model: string, mode: string, messages: unknown): string {
    const canonical = JSON.stringify({ provider, model, mode, messages });
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
    if (!this.enabled) return null;
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
