import { z } from 'zod';

/**
 * Shared error codes (PLAN §13). REST errors are JSON `{ code, message, requestId? }`.
 * SSE guardrail refusals are assistant text, not these codes.
 */
export const ERROR_CODES = [
  // auth / request
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN',
  'RATE_LIMITED',
  'ORIGIN_FORBIDDEN',
  'PAYLOAD_TOO_LARGE',
  // budgets / providers
  'BUDGET_EXHAUSTED',
  'PROVIDER_UNAVAILABLE',
  'LLM_MODE_NO_CASSETTE',
  // cart / orders
  'CART_EMPTY',
  'CART_LIMIT',
  'OUT_OF_STOCK',
  'ORDER_LIMIT',
  'NO_ADDRESS',
  'INTENT_UNRESOLVED',
  'NEEDS_CLARIFICATION',
  'CANCEL_WINDOW_CLOSED',
  // misc
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export function isErrorCode(value: unknown): value is ErrorCode {
  return errorCodeSchema.safeParse(value).success;
}

/** Shape of every REST error response body. */
export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  requestId: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
