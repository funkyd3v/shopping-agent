/**
 * `pnpm guardrails:inspect [--rule X] [--action Y] [--session Z] [--since ISO]
 * [--limit N] [--json]` — read-only audit of `guardrail_events` (PLAN §16).
 *
 * Prints rule/action rows and a per-rule summary. Never prints raw message
 * text: `details_json` holds rule ids, counters and scores only (PLAN §10.3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import dotenv from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client';

for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to inspect guardrail events.');
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  try {
    const rule = flag('rule');
    const action = flag('action');
    const sessionId = flag('session');
    const userId = flag('user');
    const sinceValue = flag('since');
    const since = sinceValue ? new Date(sinceValue) : undefined;
    if (since && Number.isNaN(since.getTime())) throw new Error('--since must be an ISO date.');
    const limit = Number(flag('limit') ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('--limit must be an integer between 1 and 1000.');
    }

    const where = {
      ...(rule ? { rule } : {}),
      ...(action ? { action } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(userId ? { userId } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    };
    const [rows, grouped] = await Promise.all([
      prisma.guardrailEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
      prisma.guardrailEvent.groupBy({
        by: ['rule', 'action'],
        where,
        _count: { _all: true },
        orderBy: { rule: 'asc' },
      }),
    ]);

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ where, total: rows.length, rows, grouped }, null, 2));
      return;
    }

    console.log(`guardrail_events (last ${rows.length} of matching rows)\n`);
    const display = rows.map((row) => [
      row.createdAt.toISOString(),
      row.rule,
      row.action,
      row.score === null ? '-' : row.score.toFixed(3),
      row.sessionId,
      (row.detailsJson ?? '{}').slice(0, 100),
    ]);
    const header = ['createdAt', 'rule', 'action', 'score', 'session', 'details'];
    const widths = header.map((_, index) =>
      Math.max(...[header, ...display].map((line) => (line[index] ?? '').length)),
    );
    for (const [index, line] of [header, ...display].entries()) {
      console.log(line.map((cell, column) => (cell ?? '').padEnd(widths[column])).join('  '));
      if (index === 0) console.log(widths.map((width) => '-'.repeat(width)).join('  '));
    }
    console.log('\nby rule/action:');
    for (const group of grouped) {
      console.log(`  ${group.rule} ${group.action}: ${group._count._all}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Guardrail inspect failed:', error);
  process.exit(1);
});
