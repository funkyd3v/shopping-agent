import type { Metadata } from 'next';
import { AssistantChat } from '@/components/assistant-chat';

export const metadata: Metadata = { title: 'Assistant' };

export default function AssistantPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-8 space-y-2">
        <p className="text-sm font-medium text-accent">AI assistant</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Assistant</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Find products, summarize customer reviews, and look up your orders in plain language. The
          assistant acts directly and reports what it found.
        </p>
      </header>

      <AssistantChat />
    </div>
  );
}
