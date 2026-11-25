'use client';

import type { ChatMessage } from '@shopping-agent/shared';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ApiError, chatApi } from '@/lib/api';
import { readSseEvents } from '@/lib/sse';
import { type ChatEntry, ChatMessageView } from './chat-message';
import { SignInPanel } from './products-browser';

const EXAMPLES = [
  'How long does standard shipping take?',
  'What is the return window?',
  'Which payment methods do you accept?',
];

const SESSION_STORAGE_KEY = 'shopping-agent:help-session';

function toEntry(message: ChatMessage): ChatEntry {
  return { ...message, key: message.id };
}

/**
 * `/help` policy chat (PLAN §12.2). One plain transcript, a text input, and a
 * Stop button while a buffered answer is generating. No agent-specific UI:
 * sources are plain text under the answer.
 */
export function HelpChat() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'thinking' | 'generating'>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load(): Promise<void> {
      try {
        const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (stored) {
          try {
            const history = await chatApi.messages(stored, controller.signal);
            if (active) {
              setSessionId(history.sessionId);
              setMessages(history.messages.map(toEntry));
            }
            return;
          } catch (caught) {
            // A deleted or expired session falls back to the newest one.
            if (!(caught instanceof ApiError) || caught.status !== 404) throw caught;
            window.localStorage.removeItem(SESSION_STORAGE_KEY);
          }
        }

        const { sessions } = await chatApi.sessions('rag', controller.signal);
        const latest = sessions[0];
        if (!active || !latest) return;
        setSessionId(latest.id);
        window.localStorage.setItem(SESSION_STORAGE_KEY, latest.id);
        const history = await chatApi.messages(latest.id, controller.signal);
        if (active) setMessages(history.messages.map(toEntry));
      } catch (caught) {
        if (!active || controller.signal.aborted) return;
        if (caught instanceof ApiError && caught.status === 401) setAuthRequired(true);
        else setError('Unable to load your conversation right now. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  // Keep the newest turn in view while tokens arrive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on transcript changes
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function send(): Promise<void> {
    const text = input.trim();
    if (text.length === 0 || busy) return;

    const clientMessageId = crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;
    const userKey = `user:${clientMessageId}`;
    const assistantKey = `assistant:${clientMessageId}`;
    let started = false;

    setBusy(true);
    setPhase('thinking');
    setError(undefined);
    setNotice(undefined);
    setInput('');
    setMessages((previous) => [
      ...previous,
      {
        key: userKey,
        id: userKey,
        role: 'user',
        content: text,
        status: 'complete',
        createdAt: new Date().toISOString(),
      },
      {
        key: assistantKey,
        id: assistantKey,
        role: 'assistant',
        content: '',
        status: 'complete',
        createdAt: new Date().toISOString(),
        pending: true,
      },
    ]);

    try {
      const response = await chatApi.stream(
        { sessionId, clientMessageId, message: text },
        controller.signal,
      );

      for await (const event of readSseEvents(response)) {
        switch (event.type) {
          case 'message_start':
            started = true;
            setSessionId(event.sessionId);
            window.localStorage.setItem(SESSION_STORAGE_KEY, event.sessionId);
            setMessages((previous) =>
              previous.map((entry) =>
                entry.key === assistantKey ? { ...entry, id: event.messageId } : entry,
              ),
            );
            break;
          case 'status':
            setPhase(event.phase);
            break;
          case 'token':
            setMessages((previous) =>
              previous.map((entry) =>
                entry.key === assistantKey
                  ? { ...entry, content: entry.content + event.text, pending: false }
                  : entry,
              ),
            );
            break;
          case 'error':
            setError(event.message);
            setMessages((previous) =>
              previous.map((entry) =>
                entry.key === assistantKey ? { ...entry, status: 'error', pending: false } : entry,
              ),
            );
            break;
          case 'done':
            setMessages((previous) =>
              previous.map((entry) =>
                entry.key === assistantKey
                  ? {
                      ...entry,
                      status: event.status === 'ok' ? 'complete' : 'error',
                      pending: false,
                    }
                  : entry,
              ),
            );
            break;
          default:
            break;
        }
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        setNotice('Stopped.');
        setMessages((previous) =>
          previous.flatMap((entry) => {
            if (entry.key !== assistantKey) return [{ ...entry, pending: false }];
            return entry.content.length > 0 ? [{ ...entry, pending: false }] : [];
          }),
        );
      } else if (caught instanceof ApiError && caught.status === 401) {
        setAuthRequired(true);
        setMessages((previous) =>
          previous.filter((entry) => entry.key !== assistantKey && entry.key !== userKey),
        );
      } else {
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Unable to send your question right now. Please try again.',
        );
        if (!started) {
          // Nothing was accepted: drop the optimistic turn and restore the text.
          setMessages((previous) =>
            previous.filter((entry) => entry.key !== assistantKey && entry.key !== userKey),
          );
          setInput(text);
        } else {
          setMessages((previous) =>
            previous.map((entry) =>
              entry.key === assistantKey ? { ...entry, status: 'error', pending: false } : entry,
            ),
          );
        }
      }
    } finally {
      setBusy(false);
      setPhase(undefined);
      abortRef.current = null;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  function applyExample(example: string): void {
    setInput(example);
    inputRef.current?.focus();
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading your conversation…</p>;
  }

  if (authRequired) {
    return (
      <SignInPanel message="Sign in to ask about store policies and keep your conversation." />
    );
  }

  return (
    <div className="space-y-8">
      {messages.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border p-6">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Ask about store policies
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Answers come only from the store policy documents, with the sections listed underneath.
            For product recommendations, your cart, or your orders, use{' '}
            <a
              href="/products"
              className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
            >
              Products
            </a>
            ,{' '}
            <a
              href="/cart"
              className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
            >
              Cart
            </a>
            , or{' '}
            <a
              href="/orders"
              className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
            >
              Orders
            </a>
            .
          </p>
          <ul className="mt-4 flex flex-col items-start gap-1">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => applyExample(example)}
                  className="text-left text-sm text-accent underline underline-offset-4 hover:text-accent/80"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section aria-label="Conversation" className="space-y-6">
          {messages.map((message) => (
            <div
              key={message.key}
              className="border-t border-border pt-6 first:border-t-0 first:pt-0"
            >
              <ChatMessageView message={message} />
            </div>
          ))}
          <div ref={endRef} />
        </section>
      )}

      <p className="sr-only" role="status">
        {busy ? (phase === 'generating' ? 'Writing an answer.' : 'Thinking.') : ''}
      </p>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/25 bg-destructive-soft p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-2">
        <label htmlFor="help-question" className="text-sm font-medium">
          Your question
        </label>
        <textarea
          id="help-question"
          ref={inputRef}
          className="field-input min-h-24 resize-y"
          rows={2}
          maxLength={2000}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. How long does standard shipping take?"
          disabled={busy}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            {busy ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-block size-3 animate-spin rounded-full border-2 border-border border-t-foreground"
                />
                {phase === 'generating' ? 'Writing an answer…' : 'Thinking…'}
              </>
            ) : (
              'Shipping, returns, warranty, payments, privacy, cancellations.'
            )}
          </p>
          <div className="flex items-center gap-2">
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="btn btn-secondary"
              >
                Stop
              </button>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || input.trim().length === 0}
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
