import { z } from 'zod';
import { RAG_POLICY, SCOPE_CLASSIFIER_SYSTEM_PROMPT } from '../guardrails/guardrails.policy';
import type { ChatMessage } from '../model-gateway/model-gateway.service';
import type { HistoryTurn } from './condense';
import { isTurnAborted } from './retriever';

/**
 * Scope guard (PLAN §7): a cheap heuristic first, then a small JSON classifier
 * only for ambiguous questions. Classifier failure degrades to "allow" because
 * RAG is read-only (PLAN §10.4).
 */
export type ScopeHeuristic = 'in' | 'out' | 'ambiguous';

export type ScopeResolution = {
  scope: 'in' | 'out';
  confidence: number;
  source: 'heuristic' | 'classifier';
};

// Unambiguous policy phrasing wins even when the question mentions a product.
const STRONG_IN_SCOPE =
  /\b(?:return|refund|shipping|delivery|warranty|payment|privacy|cancellation|store)\s+(?:policy|policies|window|rate|rates|cost|costs|methods?|options|coverage|terms)\b|\b(?:shipping|delivery) (?:time|times|estimate|estimates|speed)\b|\bhow (?:long|soon) (?:does|do|will) (?:shipping|delivery|a refund)|\bfree shipping\b|\bvisa|mastercard|american express|amex|paypal|apple pay|google pay|cash on delivery|gift cards?|bank transfer\b|\bhow do i cancel an order\b|\bcan i cancel an order\b|\b(?:data|chat) retention\b|\bkeep (?:my|our) (?:data|chat|transcripts?)\b|\bhow long do you keep\b|\bhow much can i order\b|\bmaximum (?:order|units?)\b|\bhow many (?:units|items) can i\b|\border limit\b/i;

// Explicit actions on the user's own cart/orders are handled by /assistant.
const OUT_OF_SCOPE_ACTION =
  /\bORD-[A-Z0-9-]{3,}\b|\b(?:my|the|this|that) (?:cart|orders?)\b|\b(?:cancel|track|return) (?:my|this|that) order\b|\btrack (?:my|the|an) order\b|\border (?:status|history|number)\b|\bwhere (?:is|are) my orders?\b|\b(?:add|put|remove) (?:it|them|this|that|these|those|\d+|a|an|some|the)?\s*(?:items?|products?|units?)?\s*(?:to|from|in|into)?\s*(?:my )?cart\b|\bcheckout\b|\bplace (?:an|my) order\b|\bbuy\b|\bpurchase\b|\brecommend|\bsuggest|\bshow me (?:products?|items?|options?)\b|\bfind (?:me )?(?:a|an|some|products?|items?)\b|\bsearch (?:for|products?)\b|\bbrowse\b|\bin stock\b|\bavailability\b|\bprice of\b|\bhow much (?:is|are|does) (?:the|this|that)\b|\bbest [a-z]+ for\b/i;

const GENERIC_IN_SCOPE =
  /\b(?:polic(?:y|ies)|faq|shipping|deliver(?:y|ed)?|return(?:s|ed)?|refund(?:s|ed)?|warrant(?:y|ies)|payment(?:s)?|pay|privacy|personal data|tracking|international|customs|duties|restocking fee|cancel(?:lation)?)\b/i;

const PRODUCT_OR_ACTION =
  /\b(?:price|prices|pricing|cost|costs|stock|recommend|suggest|buy|purchase|checkout|cart|products?|items?|deals?|discounts?)\b/i;

export function classifyScopeHeuristic(message: string): ScopeHeuristic {
  const text = message.trim();
  if (text.length === 0) return 'ambiguous';
  if (STRONG_IN_SCOPE.test(text)) return 'in';
  if (OUT_OF_SCOPE_ACTION.test(text)) return 'out';
  if (GENERIC_IN_SCOPE.test(text)) return 'in';
  if (PRODUCT_OR_ACTION.test(text)) return 'out';
  return 'ambiguous';
}

export function buildScopeClassifierMessages(
  question: string,
  history: HistoryTurn[] = [],
): ChatMessage[] {
  const transcript = history
    .slice(-4)
    .map(
      (turn) =>
        `${turn.role === 'user' ? 'Customer' : 'Assistant'}: ${turn.content
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 400)}`,
    )
    .join('\n');

  return [
    { role: 'system', content: SCOPE_CLASSIFIER_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        transcript.length > 0
          ? `Recent conversation (for interpreting the latest question only):\n${transcript}\n\nLatest question: ${question}`
          : question,
    },
  ];
}

const classificationSchema = z.object({
  inScope: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export function parseScopeClassification(raw: string): z.infer<typeof classificationSchema> | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = classificationSchema.safeParse(JSON.parse(cleaned.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function resolveScope(
  question: string,
  deps: { classify: (question: string) => Promise<string>; minConfidence?: number },
): Promise<ScopeResolution> {
  const heuristic = classifyScopeHeuristic(question);
  if (heuristic !== 'ambiguous') {
    return { scope: heuristic, confidence: 1, source: 'heuristic' };
  }

  try {
    const parsed = parseScopeClassification(await deps.classify(question));
    if (!parsed) return { scope: 'in', confidence: 0.5, source: 'heuristic' };
    const minConfidence = deps.minConfidence ?? RAG_POLICY.scopeMinConfidence;
    if (!parsed.inScope && parsed.confidence >= minConfidence) {
      return { scope: 'out', confidence: parsed.confidence, source: 'classifier' };
    }
    // A low-confidence "out" must not block a legitimate policy question.
    return {
      scope: 'in',
      confidence: parsed.inScope ? parsed.confidence : 1 - parsed.confidence,
      source: 'classifier',
    };
  } catch (error) {
    if (isTurnAborted(error)) throw error;
    return { scope: 'in', confidence: 0.5, source: 'heuristic' };
  }
}
