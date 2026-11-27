import type { Metadata } from 'next';
import { HelpChat } from '@/components/help-chat';

export const metadata: Metadata = { title: 'Help' };

/**
 * The chat surface owns the viewport below the sticky header, so the transcript
 * scrolls on its own and the composer stays put at the bottom of the screen.
 * `h-full` on a `<main class="flex-1">` child resolves to `auto` (the body is
 * only `min-h-dvh`), which is why the composer used to drift with the page.
 */
export default function HelpPage() {
  return (
    <div className="fixed inset-x-0 top-16 bottom-0 overflow-x-hidden overflow-y-auto bg-background">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 px-6 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <header className="shrink-0 space-y-2">
          <p className="text-sm font-medium text-accent">Store policies</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Help</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ask about shipping, returns, warranty, payments, privacy, or cancellations. Answers are
            grounded in the store policy documents.
          </p>
        </header>

        <HelpChat />
      </div>
    </div>
  );
}
