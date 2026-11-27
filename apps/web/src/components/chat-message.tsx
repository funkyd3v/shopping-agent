import type { ChatMessage } from '@shopping-agent/shared';
import { parseChatLinks } from '@/lib/chat-links';

export type ChatEntry = ChatMessage & {
  /** Stable client key; the server id changes after `message_start`. */
  key: string;
  pending?: boolean;
};

/** Plain-text turn. No trace, token meter, or agent-specific chrome. */
export function ChatMessageView({
  message,
  assistantLabel = 'Store help',
}: {
  message: ChatEntry;
  assistantLabel?: string;
}) {
  const isUser = message.role === 'user';
  const segments = isUser ? null : keySegments(parseChatLinks(message.content));

  return (
    <article className="space-y-2" aria-label={isUser ? 'Your message' : assistantLabel}>
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {isUser ? 'You' : assistantLabel}
      </p>
      <p
        className={`text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap ${
          message.status === 'error' ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {message.content.length === 0
          ? message.pending
            ? '…'
            : ''
          : segments
            ? segments.map(({ key, segment }) =>
                segment.type === 'link' ? (
                  <a
                    key={key}
                    href={segment.href}
                    className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
                  >
                    {segment.label}
                  </a>
                ) : (
                  <span key={key}>{segment.text}</span>
                ),
              )
            : message.content}
      </p>
    </article>
  );
}

/**
 * Stable keys for rendered segments. The offset is derived from the segment
 * text, so it does not depend on array position (which can change when a
 * message is appended to).
 */
function keySegments(segments: ReturnType<typeof parseChatLinks>) {
  let offset = 0;
  return segments.map((segment) => {
    const key = `${segment.type}:${offset}`;
    offset += segment.type === 'link' ? segment.href.length : segment.text.length;
    return { key, segment };
  });
}
