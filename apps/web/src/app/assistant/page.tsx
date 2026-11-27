import type { Metadata } from 'next';
import { AssistantChat } from '@/components/assistant-chat';

export const metadata: Metadata = { title: 'Assistant' };

/**
 * The chat surface owns the viewport below the sticky header, so the transcript
 * scrolls on its own and the composer stays put at the bottom of the screen.
 * `h-full` on a `<main class="flex-1">` child resolves to `auto` (the body is
 * only `min-h-dvh`), which is why the composer used to drift with the page.
 */
export default function AssistantPage() {
  return (
    <div className="fixed inset-x-0 top-16 bottom-0 overflow-x-hidden overflow-y-auto bg-background">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 px-6 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <header className="shrink-0 space-y-2">
          <p className="text-sm font-medium text-accent">AI assistant</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Assistant</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Find products, summarize customer reviews, manage your cart, and look up your orders in
            plain language. The assistant acts directly and reports what it found.
          </p>
        </header>

        <AssistantChat />
      </div>
    </div>
  );
}
