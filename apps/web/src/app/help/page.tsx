import type { Metadata } from 'next';
import { HelpChat } from '@/components/help-chat';

export const metadata: Metadata = { title: 'Help' };

export default function HelpPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-8 space-y-2">
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
