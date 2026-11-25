'use client';

import { useEffect, useRef } from 'react';

export type SummaryItem = { fieldId: string; message: string };

type ErrorSummaryProps = {
  items: SummaryItem[];
  message?: string;
  /** Increment on each submit attempt; focus moves to the summary only then. */
  focusRequest: number;
};

export function ErrorSummary({ items, message, focusRequest }: ErrorSummaryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastFocusRequest = useRef(focusRequest);

  useEffect(() => {
    if (lastFocusRequest.current === focusRequest) return;
    lastFocusRequest.current = focusRequest;
    if (items.length > 0 || message) containerRef.current?.focus();
  }, [focusRequest, items.length, message]);

  if (items.length === 0 && !message) return null;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="alert"
      className="rounded-xl border border-destructive/25 bg-destructive-soft p-4 text-sm"
    >
      <h2 className="font-display text-sm font-semibold text-destructive">There is a problem</h2>
      {message ? <p className="mt-1 text-destructive">{message}</p> : null}
      {items.length > 0 ? (
        <ul className="mt-2 list-inside list-disc space-y-1 text-destructive">
          {items.map((item) => (
            <li key={item.fieldId}>
              <a
                href={`#${item.fieldId}`}
                className="underline decoration-destructive/40 underline-offset-4 hover:decoration-destructive"
              >
                {item.message}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
