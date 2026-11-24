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
    if (!this.enabled) return null;
    const file = join(this.dir, `${key}.json`);
    if (!existsSync(file)) return null;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { content?: string };
      return typeof data.content === 'string' ? data.content : null;
    } catch {
      return null;
    }
  }

  save(key: string, content: string): void {
    if (!this.enabled) return;
    const file = join(this.dir, `${key}.json`);
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ content, savedAt: new Date().toISOString() }, null, 2));
    } catch (err) {
      this.logger.warn(`Failed to write cassette ${key}: ${String(err)}`);
    }
  }
}
