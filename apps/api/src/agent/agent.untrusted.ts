/**
 * Tool-output scanner (PLAN §8.8). Reviews and other free text are untrusted
 * data: strip markup, neutralize instruction-like lines, and bound length
 * before anything reaches a model.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard|forget)\b.{0,60}\b(?:previous|prior|above|earlier|all)\b.{0,30}\b(?:instructions?|prompts?|rules?|directions?)\b/i,
  /\b(?:system|developer|hidden)\s*(?:prompt|message|instructions?)\b/i,
  /\byou\s+are\s+(?:now|no\s+longer)\b/i,
  /\b(?:new|updated|real)\s+instructions?\b/i,
  /\b(?:call|invoke|run|use)\s+(?:the\s+)?(?:tool|function|api)\b/i,
  /\b(?:place|create|submit|complete)\s+(?:an?\s+)?order\b/i,
  /\b(?:add|put)\b.{0,30}\b(?:to\s+(?:my\s+)?cart|in\s+(?:my\s+)?cart)\b/i,
  /\b(?:reveal|print|show|repeat)\b.{0,30}\b(?:prompt|instructions?|secret|api\s*key|password)\b/i,
  /\b(?:do\s+not|don't)\s+(?:follow|obey|listen)\b/i,
  /\b(?:assistant|ai)\b.{0,30}\b(?:must|should|will)\b.{0,30}\b(?:order|buy|purchase|cancel|add)\b/i,
];

export type ScanResult = {
  text: string;
  flagged: number;
};

export function scanUntrustedText(input: string, maxChars: number): ScanResult {
  let text = input.replace(/\r\n/g, '\n');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<\/?[a-z][^>]*>/gi, ' ');
  text = text.replace(/\b(?:javascript|vbscript|data):/gi, '');

  let flagged = 0;
  const lines = text.split('\n').map((line) => {
    if (INJECTION_PATTERNS.some((pattern) => pattern.test(line))) {
      flagged += 1;
      return '[untrusted instruction removed]';
    }
    return line;
  });

  let cleaned = lines
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned.length > maxChars) {
    cleaned = `${cleaned.slice(0, maxChars - 1).trimEnd()}…`;
  }
  return { text: cleaned, flagged };
}
