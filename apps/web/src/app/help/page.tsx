import type { Metadata } from 'next';
import { HelpChat } from '@/components/help-chat';

export const metadata: Metadata = { title: 'Help' };

export default function HelpPage() {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 px-6 py-8">
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
  );
}
