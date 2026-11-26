import { Body, Controller, Post, Res } from '@nestjs/common';
import { type ChatRequest, chatRequestSchema } from '@shopping-agent/shared';
import type { Response } from 'express';
import { type PreparedTurn, parseMessageMetadata } from '../chat/chat-session.service';
import { openSseStream, startSseHeartbeat, writeSseEvent, writeSseText } from '../chat/chat-sse';
import { getRequestContext } from '../common/context/request-context';
import { CurrentUser, requireUserId } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { isTurnAborted } from '../common/turn-abort';
import { AGENT_COPY } from './agent.policy';
import { AgentService } from './agent.service';

/**
 * `/agent/chat` buffered SSE endpoint (PLAN §8/§11). Same lifecycle as
 * `/rag/chat`: validation/auth/409 before the stream; generate → guard →
 * footer → persist → stream.
 */
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('chat')
  async chat(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.agent.begin(requireUserId(ctx), body);
    if (prepared.isReplay) {
      this.streamReplay(res, prepared);
      return;
    }
    await this.streamTurn(res, prepared);
  }

  private async streamTurn(res: Response, prepared: PreparedTurn): Promise<void> {
    const abort = new AbortController();
    const onClose = () => abort.abort();
    res.on('close', onClose);
    let stopHeartbeat: (() => void) | undefined;

    try {
      openSseStream(res);
      writeSseEvent(res, {
        type: 'message_start',
        messageId: prepared.turnId,
        sessionId: prepared.session.id,
        runId: prepared.runId,
      });
      writeSseEvent(res, { type: 'status', phase: 'thinking' });
      stopHeartbeat = startSseHeartbeat(res);

      const result = await this.agent.run(prepared, {
        signal: abort.signal,
        onProgress: (phase) => writeSseEvent(res, { type: 'status', phase }),
      });

      if (abort.signal.aborted) return;

      if (result.status === 'error' && result.error) {
        writeSseEvent(res, {
          type: 'error',
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable,
          requestId: requestId(),
        });
        writeSseEvent(res, {
          type: 'done',
          messageId: prepared.turnId,
          sessionId: prepared.session.id,
          runId: prepared.runId,
          status: 'error',
          usage: result.usage,
        });
        return;
      }

      writeSseText(res, result.text);
      writeSseEvent(res, {
        type: 'done',
        messageId: prepared.turnId,
        sessionId: prepared.session.id,
        runId: prepared.runId,
        status: 'ok',
        usage: result.usage,
      });
    } catch (error) {
      if (isTurnAborted(error) || abort.signal.aborted) {
        return;
      }
      writeSseEvent(res, {
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: AGENT_COPY.providerError,
        retryable: true,
        requestId: requestId(),
      });
      writeSseEvent(res, {
        type: 'done',
        messageId: prepared.turnId,
        sessionId: prepared.session.id,
        runId: prepared.runId,
        status: 'error',
      });
    } finally {
      stopHeartbeat?.();
      prepared.release();
      res.off('close', onClose);
      if (!res.writableEnded) res.end();
    }
  }

  private streamReplay(res: Response, prepared: PreparedTurn): void {
    const metadata = parseMessageMetadata(prepared.assistant?.metadataJson ?? null);
    openSseStream(res);
    writeSseEvent(res, {
      type: 'message_start',
      messageId: prepared.turnId,
      sessionId: prepared.session.id,
      runId: metadata.runId ?? prepared.runId,
    });
    writeSseEvent(res, { type: 'status', phase: 'generating' });
    writeSseText(res, prepared.assistant?.content ?? '');
    writeSseEvent(res, {
      type: 'done',
      messageId: prepared.turnId,
      sessionId: prepared.session.id,
      runId: metadata.runId ?? prepared.runId,
      status: 'ok',
    });
    if (!res.writableEnded) res.end();
  }
}

function requestId(): string {
  return getRequestContext()?.requestId ?? 'unknown';
}
