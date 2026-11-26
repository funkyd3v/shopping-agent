'use client';

import Link from 'next/link';
import { ChatPanel, type ChatPanelConfig } from './chat-panel';

const CONFIG: ChatPanelConfig = {
  kind: 'agent',
  sessionStorageKey: 'shopping-agent:assistant-session',
  assistantLabel: 'Assistant',
  inputLabel: 'Your message',
  placeholder: 'e.g. Find wireless headphones under $80',
  hint: 'Search products, summarize reviews, manage your cart, and look up your orders.',
  authMessage: 'Sign in to chat with the assistant and keep your conversation.',
  emptyTitle: 'Ask about products, reviews, cart, or orders',
  emptyDescription: (
    <>
      Try a product search, then ask a follow-up like “summarize reviews for the second one” or “add
      it to my cart”. You can also look up your order history. The assistant handles one request per
      turn; combine steps across turns. For shipping, returns, and other policies, use{' '}
      <Link
        href="/help"
        className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
      >
        Help
      </Link>
      .
    </>
  ),
  examples: [
    'Find wireless headphones under $80',
    'Add the second one to my cart',
    'Show my cart',
    'Show my last orders',
  ],
  errorFallback: 'Unable to reach the assistant right now. Please try again.',
};

/**
 * `/assistant` agent chat (PLAN §8/§12.2). Plain text, buffered streaming, and
 * no agent-specific chrome: the server appends product/order footers with
 * working store links.
 */
export function AssistantChat() {
  return <ChatPanel config={CONFIG} />;
}
