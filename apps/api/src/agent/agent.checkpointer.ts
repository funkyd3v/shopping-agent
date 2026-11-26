import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { getEnv } from '../config/env';

/** DI token for the compiled graph's checkpoint saver. */
export const AGENT_CHECKPOINTER = Symbol('AGENT_CHECKPOINTER');

/**
 * Separate SQLite database for LangGraph checkpoints (PLAN §8.1). The app's
 * Prisma DB stays the source of truth; checkpoints only carry bounded agent
 * state keyed by `${userId}:${sessionId}`.
 */
@Injectable()
export class SqliteAgentCheckpointer implements OnApplicationShutdown {
  private readonly logger = new Logger(SqliteAgentCheckpointer.name);
  readonly saver: SqliteSaver;

  constructor() {
    const path = resolveCheckpointPath(getEnv().CHECKPOINT_DATABASE_PATH);
    mkdirSync(dirname(path), { recursive: true });
    this.saver = SqliteSaver.fromConnString(path);
    this.saver.db.pragma('journal_mode = WAL');
    this.logger.log(`agent checkpoints: ${path}`);
  }

  onApplicationShutdown(): void {
    try {
      this.saver.db.close();
    } catch {
      // Already closed (tests / double shutdown) is fine.
    }
  }
}

export function resolveCheckpointPath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}
