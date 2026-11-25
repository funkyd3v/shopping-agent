import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

/**
 * Applies the real Prisma migration SQL to an in-memory SQLite database.
 * No live DB file, network, or Prisma CLI needed — this guards the schema,
 * FTS5 triggers, and invariants before they ever reach `pnpm db:migrate`.
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

const insertProduct = (
  db: DatabaseSync,
  id: string,
  sku: string,
  values: { name?: string; stock?: number; priceCents?: number; ratingAvg?: number } = {},
): void => {
  db.prepare(
    `INSERT INTO products (id, sku, name, description, category, price_cents, stock, rating_avg, rating_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    sku,
    values.name ?? 'Aurora Wireless Headphones',
    'Comfortable over-ear headphones',
    'Audio',
    values.priceCents ?? 8999,
    values.stock ?? 10,
    values.ratingAvg ?? 4.5,
    2,
  );
};

const insertCart = (db: DatabaseSync, id: string, userId: string): void => {
  db.prepare('INSERT INTO carts (id, user_id) VALUES (?, ?)').run(id, userId);
};

const insertCartItem = (
  db: DatabaseSync,
  id: string,
  cartId: string,
  productId: string,
  qty = 1,
): void => {
  db.prepare(
    `INSERT INTO cart_items (id, cart_id, product_id, qty, price_at_add_cents)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, cartId, productId, qty, 8999);
};

describe('Prisma migrations — auth models', () => {
  it('apply cleanly to an empty database', () => {
    const db = freshDb();
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          'users',
          'addresses',
          'products',
          'reviews',
          'carts',
          'cart_items',
          'products_fts',
        ]),
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

describe('Prisma migrations — catalog and cart invariants', () => {
  it('reject negative stock and price', () => {
    const db = freshDb();
    try {
      expect(() => insertProduct(db, 'p1', 'SKU-1', { stock: -1 })).toThrow(/stock/);
      expect(() => insertProduct(db, 'p2', 'SKU-2', { priceCents: -1 })).toThrow(/price_cents/);
    } finally {
      db.close();
    }
  });

  it('reject out-of-range review ratings', () => {
    const db = freshDb();
    try {
      insertProduct(db, 'p1', 'SKU-1');
      const insertReview = db.prepare(
        `INSERT INTO reviews (id, product_id, author_name, rating, body)
         VALUES (?, ?, ?, ?, ?)`,
      );
      expect(() => insertReview.run('r1', 'p1', 'A', 6, 'too high')).toThrow(/rating/);
      expect(() => insertReview.run('r2', 'p1', 'A', 0, 'too low')).toThrow(/rating/);
    } finally {
      db.close();
    }
  });

  it('reject qty 0 and duplicate cart lines', () => {
    const db = freshDb();
    try {
      insertUser(db, 'user_1', 'alice@example.com');
      insertProduct(db, 'p1', 'SKU-1');
      insertCart(db, 'cart_1', 'user_1');
      expect(() => insertCartItem(db, 'ci0', 'cart_1', 'p1', 0)).toThrow(/qty/);
      insertCartItem(db, 'ci1', 'cart_1', 'p1', 2);
      expect(() => insertCartItem(db, 'ci2', 'cart_1', 'p1', 1)).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it('keep one cart per user and leave the cart row after the last item is removed', () => {
    const db = freshDb();
    try {
      insertUser(db, 'user_1', 'alice@example.com');
      insertProduct(db, 'p1', 'SKU-1');
      insertCart(db, 'cart_1', 'user_1');
      expect(() => insertCart(db, 'cart_2', 'user_1')).toThrow(/UNIQUE/);
      insertCartItem(db, 'ci1', 'cart_1', 'p1', 1);
      db.prepare('DELETE FROM cart_items WHERE id = ?').run('ci1');
      const { count } = db.prepare('SELECT COUNT(*) AS count FROM carts').get() as {
        count: number;
      };
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  });

  it('sync FTS rows on insert, update, and delete', () => {
    const db = freshDb();
    try {
      insertProduct(db, 'p1', 'SKU-1', { name: 'Aurora Wireless Headphones' });
      const search = (term: string): string[] =>
        (
          db
            .prepare('SELECT product_id FROM products_fts WHERE products_fts MATCH ?')
            .all(term) as Array<{ product_id: string }>
        ).map((row) => row.product_id);

      expect(search('"aurora"*')).toEqual(['p1']);

      db.prepare('UPDATE products SET name = ? WHERE id = ?').run('Nimbus Wired Headphones', 'p1');
      expect(search('"aurora"*')).toEqual([]);
      expect(search('"nimbus"*')).toEqual(['p1']);

      db.prepare('DELETE FROM products WHERE id = ?').run('p1');
      expect(search('"nimbus"*')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
