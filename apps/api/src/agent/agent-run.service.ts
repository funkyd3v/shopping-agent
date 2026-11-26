import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../db/prisma.service';
import type { ToolCallRecord } from './agent.types';

export type AgentRunRecord = {
  sessionId: string;
  turnId: string;
  clientMessageId: string;
  agent: string;
  route: string;
  model: string;
  provider: string;
  promptVersion: string;
  toolCalls: ToolCallRecord[];
  durationMs: number;
  status: 'ok' | 'error' | 'blocked' | 'limit';
  errorCode?: string;
};

/**
 * One `agent_runs` row per chat turn (PLAN §8.1/§14). Records route, prompt
 * version, and audit-safe tool-call summaries — never raw arguments or PII.
 * Observability failures never break the turn.
 */
@Injectable()
export class AgentRunService {
  private readonly logger = new Logger(AgentRunService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(run: AgentRunRecord): Promise<void> {
    try {
      await this.prisma.agentRun.create({
        data: {
          id: ulid(),
          sessionId: run.sessionId,
          turnId: run.turnId,
          clientMessageId: run.clientMessageId,
          agent: run.agent,
          route: run.route,
          model: run.model || 'n/a',
          provider: run.provider || 'n/a',
          promptVersion: run.promptVersion,
          toolCallsJson: JSON.stringify(run.toolCalls),
          durationMs: Math.max(0, Math.round(run.durationMs)),
          status: run.status,
          errorCode: run.errorCode ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`agent run not recorded: ${String(error)}`);
    }
  }
}
