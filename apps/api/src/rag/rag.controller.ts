import { Body, Controller, Post, Res } from '@nestjs/common';
import { type ChatRequest, chatRequestSchema } from '@shopping-agent/shared';
import type { Response } from 'express';
import { type PreparedTurn, parseMessageMetadata } from '../chat/chat-session.service';
import { openSseStream, startSseHeartbeat, writeSseEvent, writeSseText } from '../chat/chat-sse';
import { getRequestContext } from '../common/context/request-context';
import { CurrentUser, requireUserId } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { withRunDeadline } from '../common/run-deadline';
import { RAG_COPY } from '../guardrails/guardrails.policy';
import { RagService } from './rag.service';
import { isTurnAborted } from './retriever';

/**
 * Buffered SSE endpoint (PLAN §11): generate → guard → footer → persist →
 * stream. `@Res()` keeps the raw response so we control headers and frames.
 * Validation/auth/409 errors are JSON before the stream starts.
 */
@Controller('rag')
export class RagController {
  constructor(private readonly rag: RagService) {}

  @Post('chat')
  async chat(
    @CurrentUser() ctx: { userId: string } | undefined,
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.rag.begin(requireUserId(ctx), body);
    if (prepared.isReplay) {
      this.streamReplay(res, prepared);
      return;
    }
    await this.streamTurn(res, prepared);
  }

  private async streamTurn(res: Response, prepared: PreparedTurn): Promise<void> {
    const abort = new AbortController();
    const deadline = withRunDeadline(abort.signal);
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

      const result = await this.rag.run(prepared, {
        signal: deadline.signal,
        onProgress: (phase) => writeSseEvent(res, { type: 'status', phase }),
      });

      if (abort.signal.aborted) return;
      if (deadline.expired()) {
        this.writeDeadlineError(res, prepared);
        return;
      }

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
      if (deadline.expired()) {
        this.writeDeadlineError(res, prepared);
        return;
      }
      if (isTurnAborted(error) || abort.signal.aborted) {
        // Aborted before completion: no assistant row, lock released in finally.
        return;
      }
      writeSseEvent(res, {
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: RAG_COPY.providerError,
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

  /** Server-side timeout: friendly error, no partial answer (PLAN §6). */
  private writeDeadlineError(res: Response, prepared: PreparedTurn): void {
    writeSseEvent(res, {
      type: 'error',
      code: 'PROVIDER_UNAVAILABLE',
      message: RAG_COPY.providerError,
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
