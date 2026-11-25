import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ChatSessionKind, ChatSource } from '@shopping-agent/shared';
import { chatSourceSchema } from '@shopping-agent/shared';
import { ulid } from 'ulid';
import { PrismaService } from '../db/prisma.service';

export type ChatSessionRecord = {
  id: string;
  userId: string;
  kind: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ChatMessageRecord = {
  id: string;
  sessionId: string;
  seq: number;
  role: string;
  content: string;
  modelContent: string | null;
  metadataJson: string | null;
  status: string;
  clientMessageId: string | null;
  createdAt: Date;
};

export type MessageMetadata = {
  turnId?: string;
  runId?: string;
  sources?: ChatSource[];
};

export type PreparedTurn = {
  session: ChatSessionRecord;
  userMessage: ChatMessageRecord;
  turnId: string;
  runId: string;
  /** Existing assistant row (status `error`) when a failed turn is retried. */
  assistant: ChatMessageRecord | null;
  /** A completed assistant row exists: replay it without re-running. */
  isReplay: boolean;
  release: () => void;
};

export function parseMessageMetadata(json: string | null): MessageMetadata {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const sources = chatSourceSchema.array().safeParse(raw.sources);
    return {
      turnId: typeof raw.turnId === 'string' ? raw.turnId : undefined,
      runId: typeof raw.runId === 'string' ? raw.runId : undefined,
      sources: sources.success ? sources.data : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Session/message lifecycle for chat turns (PLAN §11.3):
 * - per-session in-process lock (single-instance deployment);
 * - `clientMessageId` replay/retry semantics;
 * - deterministic `seq` ordering;
 * - persist the assistant turn before streaming.
 */
@Injectable()
export class ChatSessionService {
  private readonly locks = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  async resolveSession(
    userId: string,
    kind: ChatSessionKind,
    sessionId?: string,
  ): Promise<ChatSessionRecord> {
    if (sessionId) {
      const session = await this.prisma.chatSession.findFirst({
        where: { id: sessionId, userId },
      });
      if (!session || session.kind !== kind) {
        // Wrong kind or another user's session is indistinguishable from missing.
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Chat session not found.' });
      }
      return session;
    }
    return this.prisma.chatSession.create({ data: { id: ulid(), userId, kind } });
  }

  /**
   * Resolve an existing turn or create a new one. Throws 409 when another turn
   * holds the session lock, and returns a replay for a completed turn.
   */
  async beginTurn(input: {
    userId: string;
    kind: ChatSessionKind;
    sessionId?: string;
    clientMessageId: string;
    message: string;
  }): Promise<PreparedTurn> {
    const session = await this.resolveSession(input.userId, input.kind, input.sessionId);

    const existingUser = await this.prisma.message.findUnique({
      where: {
        sessionId_clientMessageId: {
          sessionId: session.id,
          clientMessageId: input.clientMessageId,
        },
      },
    });

    if (existingUser) {
      const metadata = parseMessageMetadata(existingUser.metadataJson);
      const turnId = metadata.turnId ?? ulid();
      const runId = metadata.runId ?? ulid();
      if (!metadata.turnId) {
        await this.prisma.message.update({
          where: { id: existingUser.id },
          data: { metadataJson: JSON.stringify({ turnId, runId }) },
        });
      }

      const assistant = await this.prisma.message.findFirst({
        where: { id: turnId, sessionId: session.id, role: 'assistant' },
      });

      if (assistant?.status === 'complete') {
        return {
          session,
          userMessage: existingUser,
          turnId,
          runId,
          assistant,
          isReplay: true,
          release: () => undefined,
        };
      }

      // Failed or unfinished turn: re-run under the lock, keeping the same ids.
      this.acquire(session.id);
      return {
        session,
        userMessage: existingUser,
        turnId,
        runId,
        assistant: assistant ?? null,
        isReplay: false,
        release: () => this.release(session.id),
      };
    }

    this.acquire(session.id);
    try {
      const seq = await this.nextSeq(session.id);
      const turnId = ulid();
      const runId = ulid();
      const userMessage = await this.prisma.message.create({
        data: {
          id: ulid(),
          sessionId: session.id,
          seq,
          role: 'user',
          content: input.message,
          metadataJson: JSON.stringify({ turnId, runId }),
          status: 'complete',
          clientMessageId: input.clientMessageId,
        },
      });
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          title: session.title ?? titleFrom(input.message),
          updatedAt: new Date(),
        },
      });

      return {
        session,
        userMessage,
        turnId,
        runId,
        assistant: null,
        isReplay: false,
        release: () => this.release(session.id),
      };
    } catch (error) {
      this.release(session.id);
      throw error;
    }
  }

  async updateUserModelContent(messageId: string, redacted: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { modelContent: redacted },
    });
  }

  /** Persist the final assistant turn before the first token is streamed. */
  async persistAssistant(input: {
    sessionId: string;
    turnId: string;
    runId: string;
    content: string;
    status: 'complete' | 'error';
    sources: ChatSource[];
  }): Promise<ChatMessageRecord> {
    const metadataJson = JSON.stringify({
      turnId: input.turnId,
      runId: input.runId,
      sources: input.sources,
    });
    const existing = await this.prisma.message.findUnique({ where: { id: input.turnId } });

    let row: ChatMessageRecord;
    if (existing) {
      row = await this.prisma.message.update({
        where: { id: input.turnId },
        data: { content: input.content, status: input.status, metadataJson, modelContent: null },
      });
    } else {
      const seq = await this.nextSeq(input.sessionId);
      row = await this.prisma.message.create({
        data: {
          id: input.turnId,
          sessionId: input.sessionId,
          seq,
          role: 'assistant',
          content: input.content,
          metadataJson,
          status: input.status,
          clientMessageId: null,
        },
      });
    }
    await this.prisma.chatSession.update({
      where: { id: input.sessionId },
      data: { updatedAt: new Date() },
    });
    return row;
  }

  /** Redacted history for condense/scope prompts; excludes the current message. */
  async loadRecentTurns(
    sessionId: string,
    beforeSeq: number,
    limit: number,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const rows = await this.prisma.message.findMany({
      where: {
        sessionId,
        seq: { lt: beforeSeq },
        role: { in: ['user', 'assistant'] },
        status: 'complete',
      },
      orderBy: { seq: 'desc' },
      take: limit,
    });
    return rows.reverse().map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.role === 'user' ? (row.modelContent ?? row.content) : row.content,
    }));
  }

  async listSessions(userId: string, kind: ChatSessionKind | undefined, limit: number) {
    const rows = await this.prisma.chatSession.findMany({
      where: { userId, ...(kind ? { kind } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as ChatSessionKind,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async getMessages(userId: string, sessionId: string, limit: number) {
    const session = await this.prisma.chatSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Chat session not found.' });
    }
    const rows = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { seq: 'desc' },
      take: limit,
    });
    return {
      sessionId,
      messages: rows.reverse().map((row) => {
        const metadata = parseMessageMetadata(row.metadataJson);
        return {
          id: row.id,
          role: row.role as 'user' | 'assistant' | 'system' | 'tool',
          content: row.content,
          status: row.status as 'complete' | 'error',
          createdAt: row.createdAt.toISOString(),
          ...(metadata.sources && metadata.sources.length > 0 ? { sources: metadata.sources } : {}),
        };
      }),
    };
  }

  private acquire(sessionId: string): void {
    if (this.locks.has(sessionId)) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'A response is already in progress for this chat. Please retry when it finishes.',
      });
    }
    this.locks.add(sessionId);
  }

  private release(sessionId: string): void {
    this.locks.delete(sessionId);
  }

  private async nextSeq(sessionId: string): Promise<number> {
    const latest = await this.prisma.message.findFirst({
      where: { sessionId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return (latest?.seq ?? 0) + 1;
  }
}

function titleFrom(message: string): string {
  const singleLine = message.replace(/\s+/g, ' ').trim();
  return singleLine.length > 80 ? `${singleLine.slice(0, 77)}...` : singleLine;
}
