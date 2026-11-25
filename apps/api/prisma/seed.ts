/**
 * Deterministic Phase 1 seed: demo accounts, catalog, reviews, and one demo cart.
 * Idempotent (keyed by email/SKU/stable IDs) and safe to rerun; orders and the
 * remaining Phase 2 fixtures arrive with the Phase 2 data work.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as argon2 from 'argon2';
import dotenv from 'dotenv';
import { ulid } from 'ulid';
import { PrismaClient } from '../src/generated/prisma/client';
import { buildCatalog, type CatalogProduct } from './catalog.data';

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

const REVIEW_AUTHORS = [
  'Jordan M.',
  'Priya S.',
  'Diego R.',
  'Sam K.',
  'Nora T.',
  'Elliot W.',
  'Maya L.',
  'Chris B.',
  'Avery P.',
  'Riley D.',
];

const REVIEW_TEMPLATES = [
  {
    rating: 5,
    title: 'Exactly what I wanted',
    body: 'The {product} arrived quickly and feels sturdier than I expected. I have used it daily for three weeks with no issues.',
  },
  {
    rating: 4,
    title: 'Solid everyday pick',
    body: 'Good value for the price. The {product} does what it says, though the packaging was a little plain.',
  },
  {
    rating: 5,
    title: 'Would buy again',
    body: 'I bought one for myself and a second as a gift. The {product} is easy to set up and looks great on a shelf.',
  },
  {
    rating: 3,
    title: 'Fine, with a caveat',
    body: 'The {product} works well for basic use. I wish the instructions were clearer, but support answered my question in a day.',
  },
  {
    rating: 4,
    title: 'Better than the old one',
    body: 'Replaced a much older item with the {product} and the difference is obvious. Happy with the purchase so far.',
  },
  {
    rating: 2,
    title: 'Not for me',
    body: 'The {product} is well made, but the size did not suit my space. Returning it was straightforward.',
  },
  {
    rating: 5,
    title: 'Great little upgrade',
    body: 'Small details make the {product} feel premium: the finish, the weight, and the way everything fits together.',
  },
  {
    rating: 4,
    title: 'Does the job',
    body: 'No surprises with the {product}. It showed up on time and matched the photos.',
  },
];

const DEMO_CART_ITEMS = [
  { sku: 'AUD-001-01', qty: 1 },
  { sku: 'HOM-001-02', qty: 2 },
] as const;

/** Deterministic PRNG (mulberry32) so demos/evals are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Stable ULID-shaped IDs (Crockford accepts hex) so reruns update the same rows.
 * Service-layer IDs remain time-based ULIDs; seed IDs only need determinism.
 */
function stableId(kind: string, key: string): string {
  const hex = createHash('sha256').update(`${kind}:${key}`).digest('hex').toUpperCase();
  return hex.slice(0, 26);
}

type SeedReview = {
  id: string;
  productId: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  createdAt: Date;
};

function buildReviews(product: CatalogProduct, index: number, rng: () => number): SeedReview[] {
  if (product.special === 'no-reviews') return [];
  const productId = stableId('product', product.sku);
  const count = 3 + Math.floor(rng() * 8); // 3..10
  return Array.from({ length: count }, (_, reviewIndex) => {
    const template = REVIEW_TEMPLATES[Math.floor(rng() * REVIEW_TEMPLATES.length)];
    const rating = rng() < 0.2 ? Math.max(1, template.rating - 1) : template.rating;
    return {
      id: stableId('review', `${product.sku}:${reviewIndex}`),
      productId,
      authorName: REVIEW_AUTHORS[Math.floor(rng() * REVIEW_AUTHORS.length)],
      rating,
      title: template.title,
      body: template.body.replaceAll('{product}', product.name),
      createdAt: new Date(
        Date.UTC(2026, 0, 5) + ((index * 17 + reviewIndex * 11) % 300) * 86_400_000,
      ),
    };
  });
}

async function seedCatalog(prisma: PrismaClient): Promise<{ products: number; reviews: number }> {
  const rng = mulberry32(20_261_125);
  const catalog = buildCatalog();
  let reviewCount = 0;

  for (const [index, product] of catalog.entries()) {
    const reviews = buildReviews(product, index, rng);
    const ratingCount = reviews.length;
    const ratingAvg =
      ratingCount === 0
        ? 0
        : Math.round(
            (reviews.reduce((sum, review) => sum + review.rating, 0) / ratingCount) * 100,
          ) / 100;
    const stock = product.special === 'out-of-stock' ? 0 : 2 + Math.floor(rng() * 58);

    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {
        name: product.name,
        description: product.description,
        category: product.category,
        priceCents: product.priceCents,
        stock,
        ratingAvg,
        ratingCount,
        imageUrl: product.imageUrl,
      },
      create: {
        id: stableId('product', product.sku),
        sku: product.sku,
        name: product.name,
        description: product.description,
        category: product.category,
        priceCents: product.priceCents,
        stock,
        ratingAvg,
        ratingCount,
        imageUrl: product.imageUrl,
      },
    });

    for (const review of reviews) {
      await prisma.review.upsert({
        where: { id: review.id },
        update: {
          authorName: review.authorName,
          rating: review.rating,
          title: review.title,
          body: review.body,
          createdAt: review.createdAt,
        },
        create: review,
      });
    }
    reviewCount += reviews.length;
  }

  return { products: catalog.length, reviews: reviewCount };
}

async function seedDemoCart(prisma: PrismaClient): Promise<void> {
  const alice = await prisma.user.findUnique({ where: { email: 'alice@example.com' } });
  if (!alice) return;

  const cart = await prisma.cart.upsert({
    where: { userId: alice.id },
    update: {},
    create: { id: stableId('cart', alice.email), userId: alice.id },
  });

  for (const line of DEMO_CART_ITEMS) {
    const product = await prisma.product.findUnique({ where: { sku: line.sku } });
    if (!product) continue;
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: product.id } },
      update: { qty: line.qty, priceAtAddCents: product.priceCents },
      create: {
        id: stableId('cart-item', `${alice.email}:${line.sku}`),
        cartId: cart.id,
        productId: product.id,
        qty: line.qty,
        priceAtAddCents: product.priceCents,
      },
    });
  }
}

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

    const catalog = await seedCatalog(prisma);
    await seedDemoCart(prisma);

    console.log(
      `Seeded ${demoUsers.length} demo users (password: ${DEMO_PASSWORD}), ${catalog.products} catalog products, ${catalog.reviews} reviews, and a demo cart for alice@example.com.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
