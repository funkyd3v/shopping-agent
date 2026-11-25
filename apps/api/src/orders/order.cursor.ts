import { BadRequestException } from '@nestjs/common';

export type OrderCursor = {
  createdAt: Date;
  id: string;
};

/** Opaque keyset cursor: base64url(`createdAtISO|id`). */
export function encodeOrderCursor(value: { createdAt: Date; id: string }): string {
  return Buffer.from(`${value.createdAt.toISOString()}|${value.id}`, 'utf8').toString('base64url');
}

export function decodeOrderCursor(cursor: string): OrderCursor {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator <= 0) throw new Error('missing separator');
    const createdAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (id.length === 0 || Number.isNaN(createdAt.getTime())) throw new Error('invalid cursor');
    return { createdAt, id };
  } catch {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid cursor.' });
  }
}
