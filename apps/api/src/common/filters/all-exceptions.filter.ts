import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import { type ErrorCode, isErrorCode } from '@shopping-agent/shared';
import type { Response } from 'express';
import { getRequestContext } from '../context/request-context.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'AUTH_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

/**
 * 5xx codes that are part of the public contract (PLAN §13). Their message is
 * replaced with a friendly one so provider internals never leak.
 */
const SAFE_SERVER_MESSAGES: Partial<Record<ErrorCode, string>> = {
  PROVIDER_UNAVAILABLE: 'The AI service is temporarily unavailable. Please try again.',
  BUDGET_EXHAUSTED: 'The usage limit has been reached. Please try again later.',
  LLM_MODE_NO_CASSETTE: 'This request has no recorded response.',
};

/**
 * Normalizes every error to the shared envelope `{ code, message, requestId? }`.
 * Internal exception text never reaches the client (PLAN §13).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const requestId = getRequestContext()?.requestId;

    let status = 500;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let issues: Array<{ path: string; message: string }> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const raw =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>)
          : { message: body };

      if (typeof raw.code === 'string' && isErrorCode(raw.code)) {
        code = raw.code;
        if (typeof raw.message === 'string') message = raw.message;
        if (Array.isArray(raw.issues))
          issues = raw.issues as Array<{ path: string; message: string }>;
      } else {
        code = STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR');
        if (Array.isArray(raw.message)) message = raw.message.join('; ');
        else if (typeof raw.message === 'string') message = raw.message;
      }

      if (status >= 500) {
        // Never leak internal exception text to the client; keep only contract codes.
        const safeMessage = SAFE_SERVER_MESSAGES[code];
        if (!safeMessage) {
          code = 'INTERNAL_ERROR';
          message = 'Something went wrong. Please try again.';
        } else {
          message = safeMessage;
        }
        issues = undefined;
      }
    }

    const payload: Record<string, unknown> = { code, message };
    if (issues && issues.length > 0) payload.issues = issues;
    if (requestId) payload.requestId = requestId;
    res.status(status).json(payload);
  }
}
