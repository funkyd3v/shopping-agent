import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

/**
 * Applies the real Prisma migration SQL to an in-memory SQLite database.
 * No live DB file, network, or Prisma CLI needed — this guards the Phase 1
 * User/Address constraints before they ever reach `pnpm db:migrate`.
 */
const migrationsDir = path.resolve(process.cwd(), 'prisma/migrations');

function migrationSql(): string[] {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'));
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const sql of migrationSql()) db.exec(sql);
  return db;
}

const insertUser = (db: DatabaseSync, id: string, email: string): void => {
  db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)').run(
    id,
    email,
    'hash',
    'Demo User',
  );
};

const insertAddress = (db: DatabaseSync, id: string, userId: string): void => {
  db.prepare(
    `INSERT INTO addresses (id, user_id, line1, city, postal_code, country)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, '1 Market Street', 'San Francisco', '94105', 'US');
};

describe('Prisma migrations — Phase 1 User/Address', () => {
  it('apply cleanly to an empty database', () => {
    const db = freshDb();
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining(['users', 'addresses']),
      );
    } finally {
      db.close();
    }
  });

  it('enforce a unique email per user', () => {
    const db = freshDb();
    try {
      insertUser(db, 'user_1', 'alice@example.com');
      expect(() => insertUser(db, 'user_2', 'alice@example.com')).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it('allow at most one address per user', () => {
    const db = freshDb();
    try {
      insertUser(db, 'user_1', 'alice@example.com');
      insertAddress(db, 'address_1', 'user_1');
      expect(() => insertAddress(db, 'address_2', 'user_1')).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it('cascade address deletion when the user is deleted', () => {
    const db = freshDb();
    try {
      insertUser(db, 'user_1', 'alice@example.com');
      insertAddress(db, 'address_1', 'user_1');
      db.prepare('DELETE FROM users WHERE id = ?').run('user_1');
      const { count } = db.prepare('SELECT COUNT(*) AS count FROM addresses').get() as {
        count: number;
      };
      expect(count).toBe(0);
    } finally {
      db.close();
    }
  });
});
