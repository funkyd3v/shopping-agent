import { type ArgumentsHost, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function runFilter(exception: unknown): { status: number; body: Record<string, unknown> } {
  const json = vi.fn();
  const status = vi.fn((code: number) => {
    json.mockReturnValue(code);
    return { json: (body: Record<string, unknown>) => json(body) };
  });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return { status: status.mock.calls[0]?.[0] ?? 0, body: json.mock.calls[0]?.[0] ?? {} };
}

describe('AllExceptionsFilter', () => {
  it('keeps the public PROVIDER_UNAVAILABLE code but hides provider details', () => {
    const { status, body } = runFilter(
      new HttpException(
        { code: 'PROVIDER_UNAVAILABLE', message: 'No usable model for this chain' },
        503,
      ),
    );

    expect(status).toBe(503);
    expect(body.code).toBe('PROVIDER_UNAVAILABLE');
    expect(body.message).not.toContain('chain');
  });

  it('collapses unknown 5xx errors to INTERNAL_ERROR without leaking text', () => {
    const { status, body } = runFilter(new Error('SQLITE_BUSY: database is locked'));

    expect(status).toBe(500);
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('SQLITE_BUSY');
  });

  it('preserves 4xx validation codes and field issues', () => {
    const { status, body } = runFilter(
      new HttpException(
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          issues: [{ path: 'email', message: 'Enter a valid email address.' }],
        },
        400,
      ),
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid input',
      issues: [{ path: 'email', message: 'Enter a valid email address.' }],
    });
  });
});
