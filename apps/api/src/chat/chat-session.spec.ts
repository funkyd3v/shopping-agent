import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ChatSessionService, parseMessageMetadata } from './chat-session.service';

type SessionRow = {
  id: string;
  userId: string;
  kind: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRow = {
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

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const condition = expected as { lt?: number; in?: string[] };
      if (condition.lt !== undefined && !(Number(actual) < condition.lt)) return false;
      if (condition.in !== undefined && !condition.in.includes(String(actual))) return false;
      return true;
    }
    return actual === expected;
  });
}

/** Minimal in-memory Prisma surface for the chat session lifecycle. */
function fakePrisma() {
  const sessions: SessionRow[] = [];
  const messages: MessageRow[] = [];

  const prisma = {
    chatSession: {
      async findFirst({ where }: { where: Where }) {
        return sessions.find((row) => matches(row as never, where)) ?? null;
      },
      async create({
        data,
      }: {
        data: Partial<SessionRow> & { id: string; userId: string; kind: string };
      }) {
        const now = new Date();
        const row: SessionRow = {
          id: data.id,
          userId: data.userId,
          kind: data.kind,
          title: data.title ?? null,
          createdAt: now,
          updatedAt: now,
        };
        sessions.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) {
        const row = sessions.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('session missing');
        Object.assign(row, data);
        return row;
      },
      async findMany({
        where,
        orderBy,
        take,
      }: {
        where: Where;
        orderBy?: { updatedAt: 'desc' };
        take?: number;
      }) {
        let rows = sessions.filter((row) => matches(row as never, where));
        if (orderBy?.updatedAt === 'desc') {
          rows = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        }
        return take ? rows.slice(0, take) : rows;
      },
    },
    message: {
      async findUnique({ where }: { where: Where }) {
        const compound = where.sessionId_clientMessageId as
          | { sessionId: string; clientMessageId: string }
          | undefined;
        if (compound) {
          return (
            messages.find(
              (row) =>
                row.sessionId === compound.sessionId &&
                row.clientMessageId === compound.clientMessageId,
            ) ?? null
          );
        }
        return messages.find((row) => row.id === where.id) ?? null;
      },
      async findFirst({ where, orderBy }: { where: Where; orderBy?: { seq: 'desc' } }) {
        let rows = messages.filter((row) => matches(row as never, where));
        if (orderBy?.seq === 'desc') rows = rows.sort((a, b) => b.seq - a.seq);
        return rows[0] ?? null;
      },
      async findMany({
        where,
        orderBy,
        take,
      }: {
        where: Where;
        orderBy?: { seq: 'desc' };
        take?: number;
      }) {
        let rows = messages.filter((row) => matches(row as never, where));
        if (orderBy?.seq === 'desc') rows = rows.sort((a, b) => b.seq - a.seq);
        return take ? rows.slice(0, take) : rows;
      },
      async create({
        data,
      }: {
        data: Partial<MessageRow> & { id: string; sessionId: string; seq: number; role: string };
      }) {
        const row: MessageRow = {
          id: data.id,
          sessionId: data.sessionId,
          seq: data.seq,
          role: data.role,
          content: data.content ?? '',
          modelContent: data.modelContent ?? null,
          metadataJson: data.metadataJson ?? null,
          status: data.status ?? 'complete',
          clientMessageId: data.clientMessageId ?? null,
          createdAt: new Date(),
        };
        messages.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<MessageRow> }) {
        const row = messages.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('message missing');
        Object.assign(row, data);
        return row;
      },
    },
  };

  return { prisma: prisma as never, sessions, messages };
}

describe('parseMessageMetadata', () => {
  it('reads turn identity and sources, ignoring malformed data', () => {
    expect(parseMessageMetadata(null)).toEqual({});
    expect(parseMessageMetadata('not json')).toEqual({});
    expect(
      parseMessageMetadata(
        JSON.stringify({
          turnId: 'm1',
          runId: 'r1',
          sources: [{ source: 's.md', title: 'S', section: 'A' }],
        }),
      ),
    ).toEqual({
      turnId: 'm1',
      runId: 'r1',
      sources: [{ source: 's.md', title: 'S', section: 'A' }],
    });
    expect(parseMessageMetadata(JSON.stringify({ sources: [{ bad: true }] }))).toEqual({
      turnId: undefined,
      runId: undefined,
      sources: undefined,
    });
  });
});

describe('ChatSessionService', () => {
  it('creates a session, user message, and title for a new turn', async () => {
    const { prisma, messages } = fakePrisma();
    const service = new ChatSessionService(prisma);
    const turn = await service.beginTurn({
      userId: 'u1',
      kind: 'rag',
      clientMessageId: 'client-0001',
      message: 'How long does shipping take?',
    });

    expect(turn.isReplay).toBe(false);
    expect(turn.session.kind).toBe('rag');
    expect(turn.session.title).toBe('How long does shipping take?');
    expect(messages[0]).toMatchObject({
      seq: 1,
      role: 'user',
      content: 'How long does shipping take?',
      clientMessageId: 'client-0001',
    });
    expect(parseMessageMetadata(turn.userMessage.metadataJson)).toEqual({
      turnId: turn.turnId,
      runId: turn.runId,
    });
    turn.release();
  });

  it('replays a completed turn and returns the stored assistant row', async () => {
    const { prisma } = fakePrisma();
    const service = new ChatSessionService(prisma);
    const turn = await service.beginTurn({
      userId: 'u1',
      kind: 'rag',
      clientMessageId: 'client-0001',
      message: 'Hello',
    });
    await service.persistAssistant({
      sessionId: turn.session.id,
      turnId: turn.turnId,
      runId: turn.runId,
      content: 'Grounded answer',
      status: 'complete',
      sources: [],
    });

    const replay = await service.beginTurn({
      userId: 'u1',
      kind: 'rag',
      sessionId: turn.session.id,
      clientMessageId: 'client-0001',
      message: 'Hello',
    });
    expect(replay.isReplay).toBe(true);
    expect(replay.assistant?.content).toBe('Grounded answer');
    turn.release();
  });

  it('rejects a second in-flight turn with 409 and re-runs a failed one', async () => {
    const { prisma } = fakePrisma();
    const service = new ChatSessionService(prisma);
    const turn = await service.beginTurn({
      userId: 'u1',
      kind: 'rag',
      clientMessageId: 'client-0001',
      message: 'Hello',
    });

    await expect(
      service.beginTurn({
        userId: 'u1',
        kind: 'rag',
        sessionId: turn.session.id,
        clientMessageId: 'client-0002',
        message: 'Another',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.persistAssistant({
      sessionId: turn.session.id,
      turnId: turn.turnId,
      runId: turn.runId,
      content: 'Failed answer',
      status: 'error',
      sources: [],
    });
    turn.release();

    const retry = await service.beginTurn({
      userId: 'u1',
      kind: 'rag',
      sessionId: turn.session.id,
      clientMessageId: 'client-0001',
      message: 'Hello',
    });
    expect(retry.isReplay).toBe(false);
    expect(retry.turnId).toBe(turn.turnId);
    expect(retry.assistant?.status).toBe('error');
    retry.release();
  });

  it('hides sessions that are missing, owned by someone else, or of another kind', async () => {
    const { prisma } = fakePrisma();
    const service = new ChatSessionService(prisma);
    const turn = await service.beginTurn({
      userId: 'u1',
      kind: 'rag',
      clientMessageId: 'client-0001',
      message: 'Hello',
    });
    turn.release();

    await expect(service.resolveSession('u2', 'rag', turn.session.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.resolveSession('u1', 'agent', turn.session.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getMessages('u2', turn.session.id, 20)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists sessions by owner and kind, newest first', async () => {
    const { prisma } = fakePrisma();
    const service = new ChatSessionService(prisma);
    const first = await service.beginTurn({
      userId: 'u1',
      kind: 'rag',
      clientMessageId: 'client-0001',
      message: 'First',
    });
    first.release();
    const second = await service.beginTurn({
      userId: 'u1',
      kind: 'agent',
      clientMessageId: 'client-0002',
      message: 'Second',
    });
    second.release();

    const rag = await service.listSessions('u1', 'rag', 10);
    expect(rag).toHaveLength(1);
    expect(rag[0]?.id).toBe(first.session.id);
    expect(await service.listSessions('u2', undefined, 10)).toEqual([]);
  });

  it('persists assistant content + sources and returns them from getMessages', async () => {
    const { prisma } = fakePrisma();
    const service = new ChatSessionService(prisma);
    const turn = await service.beginTurn({
      userId: 'u1',
      kind: 'rag',
      clientMessageId: 'client-0001',
      message: 'Hello',
    });
    await service.persistAssistant({
      sessionId: turn.session.id,
      turnId: turn.turnId,
      runId: turn.runId,
      content: 'Answer\n\nSources:\n- Shipping Policy — Rates',
      status: 'complete',
      sources: [{ source: 'shipping.md', title: 'Shipping Policy', section: 'Rates' }],
    });
    turn.release();

    const history = await service.getMessages('u1', turn.session.id, 20);
    expect(history.messages).toHaveLength(2);
    expect(history.messages[1]).toMatchObject({
      id: turn.turnId,
      role: 'assistant',
      status: 'complete',
      sources: [{ source: 'shipping.md', title: 'Shipping Policy', section: 'Rates' }],
    });
  });

  it('loads redacted recent turns before the current message', async () => {
    const { prisma } = fakePrisma();
    const service = new ChatSessionService(prisma);
    const turn = await service.beginTurn({
      userId: 'u1',
      kind: 'rag',
      clientMessageId: 'client-0001',
      message: 'My email is alice@example.com',
    });
    await service.updateUserModelContent(turn.userMessage.id, 'My email is [REDACTED_EMAIL]');
    await service.persistAssistant({
      sessionId: turn.session.id,
      turnId: turn.turnId,
      runId: turn.runId,
      content: 'We do not store emails.',
      status: 'complete',
      sources: [],
    });

    turn.release();
    const next = await service.beginTurn({
      userId: 'u1',
      kind: 'rag',
      sessionId: turn.session.id,
      clientMessageId: 'client-0002',
      message: 'And refunds?',
    });
    const history = await service.loadRecentTurns(turn.session.id, next.userMessage.seq, 10);
    expect(history).toEqual([
      { role: 'user', content: 'My email is [REDACTED_EMAIL]' },
      { role: 'assistant', content: 'We do not store emails.' },
    ]);
    turn.release();
    next.release();
  });
});
