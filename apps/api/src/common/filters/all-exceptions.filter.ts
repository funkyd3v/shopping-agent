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
        // Never leak internal error details.
        code = 'INTERNAL_ERROR';
        message = 'Something went wrong. Please try again.';
        issues = undefined;
      }
    }

    const payload: Record<string, unknown> = { code, message };
    if (issues && issues.length > 0) payload.issues = issues;
    if (requestId) payload.requestId = requestId;
    res.status(status).json(payload);
  }
}
