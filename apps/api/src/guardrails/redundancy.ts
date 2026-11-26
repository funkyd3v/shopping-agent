/**
 * Redundancy guardrail (PLAN §10.2/§10.5). Runs on the buffered reply before
 * footers/persist. Code-enforced short-circuit: no regeneration, no interrupts.
 * Explicit re-requests and server-generated receipts are exempt.
 */
import { REDUNDANCY_POLICY } from './guardrails.policy';

export type RedundancyReason = 'repeated-tool' | 'near-duplicate-reply' | 'none';

export type RedundancyVerdict = {
  redundant: boolean;
  reason: RedundancyReason;
  /** Jaccard score of the closest reply, or the repeated-call count. */
  score: number;
  rule: string;
};

export type ToolCallLike = { name: string; args?: unknown };

const EXPLICIT_REPEAT =
  /\b(?:say (?:that|it) again|repeat (?:that|it|the (?:answer|list|summary))|one more time|show (?:me )?it again|again please|same (?:answer|list|summary) again)\b/i;
const RECEIPT_TOOLS = new Set([
  'place_order',
  'checkout_cart',
  'cancel_order',
  'quote_order',
  'view_cart',
  'add_to_cart',
  'update_cart_item',
]);

/** Normalized-token Jaccard: lowercase words, numbers and identifiers kept. */
export function normalizedTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9$£€]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  return new Set(tokens);
}

export function tokenJaccard(a: string, b: string): number {
  const left = normalizedTokens(a);
  const right = normalizedTokens(b);
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function signature(call: ToolCallLike): string {
  let args = '';
  try {
    args = JSON.stringify(call.args ?? null);
  } catch {
    args = 'unserializable';
  }
  return `${call.name}:${args}`;
}

export function detectRedundancy(input: {
  reply: string;
  /** Recent assistant messages, oldest first. */
  assistantHistory: string[];
  toolCalls?: ToolCallLike[];
  userMessage?: string;
  threshold?: number;
}): RedundancyVerdict {
  const threshold = input.threshold ?? REDUNDANCY_POLICY.similarityThreshold;
  const none: RedundancyVerdict = { redundant: false, reason: 'none', score: 0, rule: 'none' };

  // Exemption 1: the user explicitly asked to hear it again.
  if (input.userMessage && EXPLICIT_REPEAT.test(input.userMessage)) return none;

  const toolCalls = input.toolCalls ?? [];
  // Exemption 2: receipts and cart summaries are intentionally repeated.
  if (toolCalls.some((call) => RECEIPT_TOOLS.has(call.name))) return none;

  // A tool loop is caught even when the model phrases each reply differently.
  const counts = new Map<string, number>();
  for (const call of toolCalls) {
    const key = signature(call);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = Math.max(0, ...counts.values());
  if (repeated > REDUNDANCY_POLICY.maxRepeatedToolCalls) {
    return {
      redundant: true,
      reason: 'repeated-tool',
      score: repeated,
      rule: 'redundancy.tool_loop',
    };
  }

  if (input.reply.trim().length < REDUNDANCY_POLICY.minReplyChars) return none;
  const recent = input.assistantHistory.slice(-REDUNDANCY_POLICY.historyTurns);
  let closest = 0;
  for (const previous of recent) {
    closest = Math.max(closest, tokenJaccard(input.reply, previous));
  }
  if (closest >= threshold) {
    return {
      redundant: true,
      reason: 'near-duplicate-reply',
      score: Number(closest.toFixed(3)),
      rule: 'redundancy.duplicate_reply',
    };
  }
  return none;
}
