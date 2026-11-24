/**
 * Phase 1 seed: demo accounts for the login/register pages and manual API checks.
 * Idempotent (keyed by email) and safe to rerun; the catalog seed arrives in Phase 2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as argon2 from 'argon2';
import dotenv from 'dotenv';
import { ulid } from 'ulid';
import { PrismaClient } from '../src/generated/prisma/client';

// Prisma 7 does not auto-load .env; mirror prisma.config.ts resolution.
for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const DEMO_PASSWORD = 'Demo1234!';

const demoUsers = [
  {
    email: 'alice@example.com',
    name: 'Alice Chen',
    address: {
      line1: '1 Market Street',
      line2: 'Apt 4B',
      city: 'San Francisco',
      region: 'CA',
      postalCode: '94105',
      country: 'US',
    },
  },
  {
    email: 'bob@example.com',
    name: 'Bob Rivera',
    address: {
      line1: '42 Elm Avenue',
      line2: null,
      city: 'Austin',
      region: 'TX',
      postalCode: '78701',
      country: 'US',
    },
  },
  {
    email: 'carol@example.com',
    name: 'Carol Nguyen',
    address: {
      line1: '300 King Street West',
      line2: null,
      city: 'Toronto',
      region: 'ON',
      postalCode: 'M5V 1J2',
      country: 'CA',
    },
  },
] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (see .env.example).');

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  try {
    for (const demo of demoUsers) {
      let user = await prisma.user.findUnique({ where: { email: demo.email } });
      if (!user) {
        const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
        user = await prisma.user.create({
          data: {
            id: ulid(),
            email: demo.email,
            name: demo.name,
            passwordHash,
          },
        });
      }
      // Upsert keeps reruns idempotent even if the user already exists without an address.
      await prisma.address.upsert({
        where: { userId: user.id },
        update: {},
        create: { id: ulid(), userId: user.id, ...demo.address },
      });
    }
    console.log(`Seeded ${demoUsers.length} demo users (password: ${DEMO_PASSWORD}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
