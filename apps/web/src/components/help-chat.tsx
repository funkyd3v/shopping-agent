'use client';

import Link from 'next/link';
import { ChatPanel, type ChatPanelConfig } from './chat-panel';

const CONFIG: ChatPanelConfig = {
  kind: 'rag',
  sessionStorageKey: 'shopping-agent:help-session',
  assistantLabel: 'Store help',
  inputLabel: 'Your question',
  placeholder: 'e.g. How long does standard shipping take?',
  hint: 'Shipping, returns, warranty, payments, privacy, cancellations.',
  authMessage: 'Sign in to ask about store policies and keep your conversation.',
  emptyTitle: 'Ask about store policies',
  emptyDescription: (
    <>
      Answers come only from the store policy documents, with the sections listed underneath. For
      product recommendations, your cart, or your orders, use{' '}
      <Link
        href="/products"
        className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
      >
        Products
      </Link>
      ,{' '}
      <Link
        href="/cart"
        className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
      >
        Cart
      </Link>
      , or{' '}
      <Link
        href="/orders"
        className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
      >
        Orders
      </Link>
      .
    </>
  ),
  examples: [
    'How long does standard shipping take?',
    'What is the return window?',
    'Which payment methods do you accept?',
  ],
  errorFallback: 'Unable to load your conversation right now. Please try again.',
};

/**
 * `/help` policy chat (PLAN §12.2). One plain transcript, a text input, and a
 * Stop button while a buffered answer is generating. No agent-specific UI:
 * sources are plain text under the answer.
 */
export function HelpChat() {
  return <ChatPanel config={CONFIG} />;
}
