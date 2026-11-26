/**
 * Local PII detection/redaction (PLAN §10.2). Runs before any provider call and
 * on buffered output. Raw text is stored for the signed-in owner; models and
 * embeddings only ever see redacted text.
 *
 * Deliberately conservative: SKUs and order numbers (alphanumeric) are never
 * treated as cards/phones; card-like digit runs require 13–19 digits.
 */
export type PiiKind = 'email' | 'phone' | 'card';

export type PiiFinding = {
  kind: PiiKind;
  count: number;
  /** For cards: true when every redacted number passed the Luhn check. */
  luhnValid?: boolean;
};

export type PiiRedaction = {
  text: string;
  findings: PiiFinding[];
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// 13–19 digits with optional single space/dash separators, not inside a word.
const CARD = /(?<![\dA-Za-z])(?:\d[ -]?){12,18}\d(?![\dA-Za-z])/g;
// 10-digit phone with separators, an international number, or a plain 10-digit run.
const PHONE =
  /(?<![\dA-Za-z])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?![\dA-Za-z])/g;
const INTL_PHONE = /(?<![\dA-Za-z])\+\d{1,3}(?:[ .-]?\d{2,4}){2,4}(?![\dA-Za-z])/g;
const PLAIN_PHONE = /(?<![\dA-Za-z])\d{10}(?![\dA-Za-z])/g;

const PLACEHOLDERS: Record<PiiKind, string> = {
  email: '[REDACTED_EMAIL]',
  phone: '[REDACTED_PHONE]',
  card: '[REDACTED_CARD]',
};

/** SKUs and order numbers can contain 10+ digits; never treat them as phones. */
const IDENTIFIER = /\b(?:SKU|ORD|ORDER|ID|SN|SERIAL|NO)[-\s]?[A-Z0-9-]{4,}\b/gi;

function protectIdentifiers(input: string): { text: string; restore: (value: string) => string } {
  const saved: string[] = [];
  const text = input.replace(IDENTIFIER, (match) => {
    const token = `@@ID${saved.length}@@`;
    saved.push(match);
    return token;
  });
  return {
    text,
    restore: (value: string) =>
      saved.reduce(
        (result, identifier, index) => result.replaceAll(`@@ID${index}@@`, identifier),
        value,
      ),
  };
}

export function redactPii(input: string): PiiRedaction {
  const identifiers = protectIdentifiers(input);
  let text = identifiers.text;
  const findings: PiiFinding[] = [];

  const cards = { count: 0, allValid: true };
  text = text.replace(CARD, (match) => {
    cards.count += 1;
    if (!luhnValid(match)) cards.allValid = false;
    return PLACEHOLDERS.card;
  });
  if (cards.count > 0) {
    findings.push({ kind: 'card', count: cards.count, luhnValid: cards.allValid });
  }

  const emails = { count: 0 };
  text = text.replace(EMAIL, () => {
    emails.count += 1;
    return PLACEHOLDERS.email;
  });
  if (emails.count > 0) findings.push({ kind: 'email', count: emails.count });

  const phones = { count: 0 };
  for (const pattern of [PHONE, INTL_PHONE, PLAIN_PHONE]) {
    text = text.replace(pattern, () => {
      phones.count += 1;
      return PLACEHOLDERS.phone;
    });
  }
  if (phones.count > 0) findings.push({ kind: 'phone', count: phones.count });

  return { text: identifiers.restore(text), findings };
}

export function containsPii(input: string): boolean {
  return redactPii(input).findings.length > 0;
}

/** Luhn checksum over the digits in a candidate card number. */
export function luhnValid(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}
