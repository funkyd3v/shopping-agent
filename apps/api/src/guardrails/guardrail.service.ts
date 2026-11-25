import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { getRequestContext } from '../common/context/request-context';
import { PrismaService } from '../db/prisma.service';

export type GuardrailAction = 'redact' | 'refuse' | 'degrade' | 'allow' | 'budget';

export type GuardrailRecord = {
  userId: string;
  sessionId: string;
  /** Stable rule id, e.g. `pii.input`, `rag.scope`, `rag.no_match`. */
  rule: string;
  action: GuardrailAction;
  score?: number;
  /** Rule ids/counters only — never raw text or PII. */
  details?: Record<string, string | number | boolean | null>;
};

/**
 * Writes one `guardrail_events` row and one structured log line per action
 * (PLAN §10.3/§18). Audit failures never break a chat turn.
 */
@Injectable()
export class GuardrailService {
  private readonly logger = new Logger(GuardrailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: GuardrailRecord): Promise<void> {
    const requestId = getRequestContext()?.requestId ?? 'system';
    const detailsJson = JSON.stringify(event.details ?? {});
    this.logger.warn(
      `guardrail rule=${event.rule} action=${event.action} session=${event.sessionId} score=${event.score ?? 'n/a'}`,
    );
    try {
      await this.prisma.guardrailEvent.create({
        data: {
          id: ulid(),
          userId: event.userId,
          sessionId: event.sessionId,
          rule: event.rule,
          action: event.action,
          score: event.score ?? null,
          detailsJson,
          requestId,
        },
      });
    } catch (error) {
      this.logger.warn(`guardrail event not persisted: ${String(error)}`);
    }
  }
}
