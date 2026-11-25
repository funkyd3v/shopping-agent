import type { ChatMessage } from '@shopping-agent/shared';

export type ChatEntry = ChatMessage & {
  /** Stable client key; the server id changes after `message_start`. */
  key: string;
  pending?: boolean;
};

/** Plain-text turn. No trace, token meter, or agent-specific chrome. */
export function ChatMessageView({ message }: { message: ChatEntry }) {
  const isUser = message.role === 'user';
  return (
    <article className="space-y-2" aria-label={isUser ? 'Your message' : 'Store help answer'}>
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {isUser ? 'You' : 'Store help'}
      </p>
      <p
        className={`text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap ${
          message.status === 'error' ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {message.content.length > 0 ? message.content : message.pending ? '…' : ''}
      </p>
      {message.sources &&
      message.sources.length > 0 &&
      !message.content.includes('\nSources:\n') ? (
        <div className="text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium">Sources</p>
          <ul className="mt-1 space-y-0.5">
            {message.sources.map((source) => (
              <li key={`${source.source}:${source.section}`}>
                {source.title} — {source.section}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
