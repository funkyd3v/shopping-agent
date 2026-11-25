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

const insertOrder = (
  db: DatabaseSync,
  id: string,
  userId: string,
  values: {
    orderNumber?: string;
    status?: string;
    source?: string;
    placedBy?: string;
    totalCents?: number;
    idempotencyKey?: string;
    turnId?: string | null;
    cancelledAt?: string | null;
  } = {},
): void => {
  db.prepare(
    `INSERT INTO orders (
       id, order_number, user_id, status, source, placed_by, total_cents,
       idempotency_key, address_snapshot_json, turn_id, cancelled_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    values.orderNumber ?? `ORD-${id}`,
    userId,
    values.status ?? 'placed',
    values.source ?? 'direct',
    values.placedBy ?? 'user',
    values.totalCents ?? 8999,
    values.idempotencyKey ?? `key-${id}`,
    JSON.stringify({ line1: '1 Market Street', city: 'San Francisco' }),
    values.turnId ?? null,
    values.cancelledAt ?? null,
  );
};

const insertOrderItem = (
  db: DatabaseSync,
  id: string,
  orderId: string,
  productId: string,
  qty = 1,
): void => {
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name, sku, qty, unit_price_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, orderId, productId, 'Aurora Wireless Headphones', 'SKU-1', qty, 8999);
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

describe('Prisma migrations — orders and observability invariants', () => {
  it('create every Phase 2 table', () => {
    const db = freshDb();
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          'orders',
          'order_items',
          'chat_sessions',
          'messages',
          'token_usage',
          'guardrail_events',
          'agent_runs',
        ]),
      );
    } finally {
      db.close();
    }
  });

  it('enforce one order per idempotency key and one order per turn per user', () => {
    const db = freshDb();
    try {
      insertUser(db, 'user_1', 'alice@example.com');
      insertOrder(db, 'o1', 'user_1', { idempotencyKey: 'same', turnId: 'turn_1' });
      expect(() =>
        insertOrder(db, 'o2', 'user_1', { idempotencyKey: 'same', turnId: 'turn_2' }),
      ).toThrow(/UNIQUE/);
      expect(() =>
        insertOrder(db, 'o3', 'user_1', { idempotencyKey: 'other', turnId: 'turn_1' }),
      ).toThrow(/UNIQUE/);

      // Page/seed orders have no turn id and must not collide with each other.
      insertOrder(db, 'o4', 'user_1', { idempotencyKey: 'seed-1', turnId: null });
      insertOrder(db, 'o5', 'user_1', { idempotencyKey: 'seed-2', turnId: null });
    } finally {
      db.close();
    }
  });

  it('reject invalid order status/source/placed_by and negative totals', () => {
    const db = freshDb();
    try {
      insertUser(db, 'user_1', 'alice@example.com');
      expect(() => insertOrder(db, 'o1', 'user_1', { status: 'pending' })).toThrow(/invariant/);
      expect(() => insertOrder(db, 'o2', 'user_1', { source: 'wishlist' })).toThrow(/invariant/);
      expect(() => insertOrder(db, 'o3', 'user_1', { placedBy: 'robot' })).toThrow(/invariant/);
      expect(() => insertOrder(db, 'o4', 'user_1', { totalCents: -1 })).toThrow(/invariant/);
      expect(() =>
        insertOrder(db, 'o5', 'user_1', { status: 'cancelled', cancelledAt: null }),
      ).toThrow(/invariant/);
      insertOrder(db, 'o6', 'user_1', {
        status: 'cancelled',
        cancelledAt: '2026-11-25T12:00:00Z',
      });
    } finally {
      db.close();
    }
  });

  it('reject non-positive order item quantities and negative unit prices', () => {
    const db = freshDb();
    try {
      insertUser(db, 'user_1', 'alice@example.com');
      insertProduct(db, 'p1', 'SKU-1');
      insertOrder(db, 'o1', 'user_1');
      expect(() => insertOrderItem(db, 'oi0', 'o1', 'p1', 0)).toThrow(/qty/);
      expect(() =>
        db
          .prepare(
            `INSERT INTO order_items (id, order_id, product_id, product_name, sku, qty, unit_price_cents)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run('oi2', 'o1', 'p1', 'Aurora', 'SKU-1', 1, -1),
      ).toThrow(/unit_price_cents/);
      insertOrderItem(db, 'oi1', 'o1', 'p1', 1);
    } finally {
      db.close();
    }
  });

  it('enforce chat session kind and message role/status/seq uniqueness', () => {
    const db = freshDb();
    try {
      insertUser(db, 'user_1', 'alice@example.com');
      const insertSession = db.prepare(
        'INSERT INTO chat_sessions (id, user_id, kind) VALUES (?, ?, ?)',
      );
      expect(() => insertSession.run('s0', 'user_1', 'support')).toThrow(/kind/);
      insertSession.run('s1', 'user_1', 'agent');

      const insertMessage = db.prepare(
        `INSERT INTO messages (id, session_id, seq, role, content, status, client_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      expect(() => insertMessage.run('m0', 's1', 1, 'robot', 'hi', 'complete', null)).toThrow(
        /invariant/,
      );
      expect(() => insertMessage.run('m1', 's1', 1, 'user', 'hi', 'pending', null)).toThrow(
        /invariant/,
      );
      expect(() => insertMessage.run('m2', 's1', 0, 'user', 'hi', 'complete', null)).toThrow(
        /invariant/,
      );
      insertMessage.run('m3', 's1', 1, 'user', 'hi', 'complete', 'client-1');
      expect(() => insertMessage.run('m4', 's1', 1, 'assistant', 'yo', 'complete', null)).toThrow(
        /UNIQUE/,
      );
      expect(() =>
        insertMessage.run('m5', 's1', 2, 'assistant', 'yo', 'complete', 'client-1'),
      ).toThrow(/UNIQUE/);
      // Multiple null client_message_id values are allowed.
      insertMessage.run('m6', 's1', 2, 'assistant', 'yo', 'complete', null);
      insertMessage.run('m7', 's1', 3, 'assistant', 'again', 'complete', null);
    } finally {
      db.close();
    }
  });

  it('enforce token usage, guardrail, and agent-run invariants', () => {
    const db = freshDb();
    try {
      insertUser(db, 'user_1', 'alice@example.com');
      const insertUsage = db.prepare(
        `INSERT INTO token_usage (id, kind, model, provider, input_tokens, output_tokens, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      expect(() => insertUsage.run('u0', 'chat', 'm', 'p', 1, 1, 1)).toThrow(/invariant/);
      expect(() => insertUsage.run('u1', 'rag', 'm', 'p', -1, 1, 1)).toThrow(/invariant/);
      insertUsage.run('u2', 'rag', 'm', 'p', 10, 20, 30);

      const insertGuardrail = db.prepare(
        `INSERT INTO guardrail_events (id, user_id, session_id, rule, action, score, details_json, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      expect(() =>
        insertGuardrail.run('g0', 'user_1', 's1', 'pii', 'redact', 1.5, '{}', 'req-1'),
      ).toThrow(/invariant/);
      insertGuardrail.run('g1', 'user_1', 's1', 'pii', 'redact', 0.9, '{}', 'req-1');

      const insertRun = db.prepare(
        `INSERT INTO agent_runs (
           id, session_id, turn_id, client_message_id, agent, route, model, provider,
           prompt_version, duration_ms, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      db.prepare('INSERT INTO chat_sessions (id, user_id, kind) VALUES (?, ?, ?)').run(
        's1',
        'user_1',
        'agent',
      );
      expect(() =>
        insertRun.run('r0', 's1', 't1', 'c1', 'search', 'search', 'm', 'p', 'v1', 10, 'done'),
      ).toThrow(/invariant/);
      insertRun.run('r1', 's1', 't1', 'c1', 'search', 'search', 'm', 'p', 'v1', 10, 'ok');
    } finally {
      db.close();
    }
  });
});
