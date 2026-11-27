'use client';

import Link from 'next/link';
import { ChatPanel, type ChatPanelConfig } from './chat-panel';

const CONFIG: ChatPanelConfig = {
  kind: 'agent',
  fixedComposer: true,
  sessionStorageKey: 'shopping-agent:assistant-session',
  assistantLabel: 'Assistant',
  inputLabel: 'Your message',
  placeholder: 'e.g. Find wireless headphones under $80',
  hint: 'Search products, summarize reviews, manage your cart, place orders, and cancel them.',
  authMessage: 'Sign in to chat with the assistant and keep your conversation.',
  emptyTitle: 'Ask about products, reviews, cart, or orders',
  emptyDescription: (
    <>
      Try a product search, then ask a follow-up like “summarize reviews for the second one”, “add
      it to my cart”, or “order 2 of the second one”. You can also check out your cart, cancel an
      order with its ORD- number, or look up your history. The assistant acts directly without a
      confirmation step and handles one request per turn. For shipping, returns, and other policies,
      use{' '}
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
    'Order 2 of the second one',
    'Check out my cart',
    'Cancel order ORD-7F3K2',
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
