-- Phase 1 completion: catalog + cart (products, reviews, carts, cart_items).
-- FTS5, triggers, and CHECK-style invariants live here because Prisma cannot
-- model them (PLAN §5). The FTS table is standalone; triggers keep it in sync.

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "rating_avg" REAL NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cart_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price_at_add_cents" INTEGER NOT NULL,
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_price_cents_idx" ON "products"("price_cents");

-- CreateIndex
CREATE INDEX "reviews_product_id_created_at_idx" ON "reviews"("product_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_product_id_key" ON "cart_items"("cart_id", "product_id");

-- CreateIndex
CREATE INDEX "cart_items_product_id_idx" ON "cart_items"("product_id");

-- Standalone FTS5 index over the searchable product columns (PLAN §5).
CREATE VIRTUAL TABLE "products_fts" USING fts5(
    product_id UNINDEXED,
    name,
    description,
    category,
    sku,
    tokenize = 'unicode61'
);

-- Keep products_fts in sync with products.
CREATE TRIGGER "products_fts_ai" AFTER INSERT ON "products" BEGIN
    INSERT INTO "products_fts" ("product_id", "name", "description", "category", "sku")
    VALUES (new."id", new."name", new."description", new."category", new."sku");
END;

CREATE TRIGGER "products_fts_ad" AFTER DELETE ON "products" BEGIN
    DELETE FROM "products_fts" WHERE "product_id" = old."id";
END;

CREATE TRIGGER "products_fts_au" AFTER UPDATE OF "name", "description", "category", "sku" ON "products" BEGIN
    DELETE FROM "products_fts" WHERE "product_id" = old."id";
    INSERT INTO "products_fts" ("product_id", "name", "description", "category", "sku")
    VALUES (new."id", new."name", new."description", new."category", new."sku");
END;

-- Invariants that SQLite cannot express as CHECK constraints after table
-- creation (PLAN §5): enforce with BEFORE INSERT/UPDATE triggers.
CREATE TRIGGER "products_price_stock_insert" BEFORE INSERT ON "products"
WHEN new."price_cents" < 0 OR new."stock" < 0
BEGIN
    SELECT RAISE(ABORT, 'products.price_cents and products.stock must be >= 0');
END;

CREATE TRIGGER "products_price_stock_update" BEFORE UPDATE ON "products"
WHEN new."price_cents" < 0 OR new."stock" < 0
BEGIN
    SELECT RAISE(ABORT, 'products.price_cents and products.stock must be >= 0');
END;

CREATE TRIGGER "products_rating_insert" BEFORE INSERT ON "products"
WHEN new."rating_avg" < 0 OR new."rating_avg" > 5 OR new."rating_count" < 0
BEGIN
    SELECT RAISE(ABORT, 'products.rating_avg must be 0..5 and rating_count >= 0');
END;

CREATE TRIGGER "products_rating_update" BEFORE UPDATE ON "products"
WHEN new."rating_avg" < 0 OR new."rating_avg" > 5 OR new."rating_count" < 0
BEGIN
    SELECT RAISE(ABORT, 'products.rating_avg must be 0..5 and rating_count >= 0');
END;

CREATE TRIGGER "reviews_rating_insert" BEFORE INSERT ON "reviews"
WHEN new."rating" < 1 OR new."rating" > 5
BEGIN
    SELECT RAISE(ABORT, 'reviews.rating must be between 1 and 5');
END;

CREATE TRIGGER "reviews_rating_update" BEFORE UPDATE ON "reviews"
WHEN new."rating" < 1 OR new."rating" > 5
BEGIN
    SELECT RAISE(ABORT, 'reviews.rating must be between 1 and 5');
END;

CREATE TRIGGER "cart_items_qty_insert" BEFORE INSERT ON "cart_items"
WHEN new."qty" <= 0 OR new."price_at_add_cents" < 0
BEGIN
    SELECT RAISE(ABORT, 'cart_items.qty must be > 0 and price_at_add_cents >= 0');
END;

CREATE TRIGGER "cart_items_qty_update" BEFORE UPDATE ON "cart_items"
WHEN new."qty" <= 0 OR new."price_at_add_cents" < 0
BEGIN
    SELECT RAISE(ABORT, 'cart_items.qty must be > 0 and price_at_add_cents >= 0');
END;
