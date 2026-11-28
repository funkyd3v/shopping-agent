import { describe, expect, it } from 'vitest';
import { AGENT_POLICY } from './agent.policy';
import { buildRouterMessages } from './agent.router';
import type { AgentGraphState } from './agent.types';

type RouterState = Pick<
  AgentGraphState,
  'message' | 'recentMessages' | 'lastListedProducts' | 'lastCartSummary' | 'lastOrder'
>;

function state(recentMessages: RouterState['recentMessages']): RouterState {
  return {
    message: 'the second one',
    recentMessages,
    lastListedProducts: [],
    lastCartSummary: null,
    lastOrder: null,
  };
}

function promptFor(limit: number, count: number): string {
  const turns = Array.from({ length: count }, (_, index) => ({
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `m${String(index + 1).padStart(2, '0')}`,
  }));
  return buildRouterMessages(state(turns), limit).at(-1)?.content ?? '';
}

describe('buildRouterMessages', () => {
  it('includes only the most recent messages for the given history limit', () => {
    const prompt = promptFor(AGENT_POLICY.routerHistoryMessages, 30);

    expect(prompt).toContain('m19');
    expect(prompt).toContain('m30');
    expect(prompt).not.toContain('m18');
    expect(prompt).not.toContain('m01');
  });

  it('honors a smaller caller-supplied limit', () => {
    const prompt = promptFor(5, 10);

    expect(prompt).toContain('m06');
    expect(prompt).not.toContain('m05');
  });

  it('keeps the latest message separate from the transcript', () => {
    const prompt = promptFor(20, 2);

    expect(prompt).toContain('Recent conversation (redacted):');
    expect(prompt).toContain('Latest message: the second one');
  });
});
