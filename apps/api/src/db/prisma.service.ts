import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { type Prisma, PrismaClient } from '../generated/prisma/client';

/**
 * Prisma service with SQLite pragmas tuned for a single-instance deployment
 * (PLAN §18): WAL + busy_timeout so the process-wide write mutex and
 * concurrent readers coexist without SQLITE_BUSY.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // The adapter reads DATABASE_URL from env; no connection string is
    // hard-coded here. The env var is validated by validateEnv() at boot.
    const adapter = new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL ?? 'file:./dev.db',
    });
    super({ adapter });
  }

  override async $connect(): Promise<void> {
    await super.$connect();
    // Pragmas are per-connection; run them once after connecting.
    await this.$executeRaw`PRAGMA journal_mode = WAL`;
    await this.$executeRaw`PRAGMA busy_timeout = 5000`;
    await this.$executeRaw`PRAGMA foreign_keys = ON`;
    await this.$executeRaw`PRAGMA synchronous = NORMAL`;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export type { Prisma };
