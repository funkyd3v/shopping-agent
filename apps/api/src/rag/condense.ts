import { RAG_POLICY } from '../guardrails/guardrails.policy';
import type { ChatMessage } from '../model-gateway/model-gateway.service';
import { isTurnAborted } from './retriever';

/**
 * Follow-up condensation (PLAN §7 step 2). Only short/pronoun-shaped messages
 * are rewritten; standalone questions skip the extra model call. Failure falls
 * back to the raw question because retrieval is read-only.
 */
export type HistoryTurn = { role: 'user' | 'assistant'; content: string };

const FOLLOW_UP =
  /^(?:and\b|also\b|then\b|what about\b|what if\b|why\b|how about\b|does (?:it|that|this|they)|do (?:they|these|those)|is (?:it|that|this)|are (?:they|these|those)|can i\b|how (?:long|much|soon) (?:does|do|is|are) (?:it|that|this|they)|which one\b|the (?:first|second|third|last|next) one\b|(?:it|that|this|they|them|those|one)\b)/i;

export function needsCondense(message: string): boolean {
  const text = message.trim();
  if (text.length === 0 || text.length > RAG_POLICY.condenseMaxChars) return false;
  return FOLLOW_UP.test(text);
}

export async function condenseQuestion(input: {
  message: string;
  history: HistoryTurn[];
  generate: (messages: ChatMessage[]) => Promise<string>;
  maxHistory?: number;
}): Promise<string> {
  const message = input.message.trim();
  if (!needsCondense(message) || input.history.length === 0) return message;

  const history = input.history.slice(-(input.maxHistory ?? RAG_POLICY.historyTurns));
  const transcript = history
    .map((turn) => `${turn.role === 'user' ? 'Customer' : 'Assistant'}: ${turn.content}`)
    .join('\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Rewrite the customer follow-up as one standalone question about store policies. Keep the original intent and any product or order references already established. Return only the rewritten question, without quotes or commentary. If it is already standalone, return it unchanged.',
    },
    {
      role: 'user',
      content: `Recent conversation:\n${transcript}\n\nFollow-up: ${message}\n\nStandalone question:`,
    },
  ];

  try {
    const answer = await input.generate(messages);
    const cleaned = answer
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!cleaned || cleaned.length < 4) return message;
    return cleaned.slice(0, 300);
  } catch (error) {
    if (isTurnAborted(error)) throw error;
    return message;
  }
}
