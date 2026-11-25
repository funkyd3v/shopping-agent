-- Phase 2: orders, chat, usage, guardrail, and agent-run tables (PLAN §5).
-- Prisma cannot model enum-like values or CHECK-style invariants on SQLite, so
-- they are enforced with BEFORE INSERT/UPDATE triggers (PLAN §5).

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_number" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "placed_by" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "idempotency_key" TEXT NOT NULL,
    "cart_id" TEXT,
    "address_snapshot_json" TEXT NOT NULL,
    "turn_id" TEXT,
    "client_message_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancellable_until" DATETIME,
    "cancelled_at" DATETIME,
    "cancelled_by" TEXT,
    CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "orders_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model_content" TEXT,
    "metadata_json" TEXT,
    "status" TEXT NOT NULL,
    "client_message_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "token_usage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "session_id" TEXT,
    "run_id" TEXT,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "token_usage_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "guardrail_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "score" REAL,
    "details_json" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guardrail_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "client_message_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "tool_calls_json" TEXT NOT NULL DEFAULT '[]',
    "duration_ms" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "orders_user_id_turn_id_key" ON "orders"("user_id", "turn_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_kind_updated_at_idx" ON "chat_sessions"("user_id", "kind", "updated_at");

-- CreateIndex
CREATE INDEX "messages_session_id_created_at_idx" ON "messages"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_session_id_seq_key" ON "messages"("session_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "messages_session_id_client_message_id_key" ON "messages"("session_id", "client_message_id");

-- CreateIndex
CREATE INDEX "token_usage_user_id_created_at_idx" ON "token_usage"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "token_usage_provider_created_at_idx" ON "token_usage"("provider", "created_at");

-- CreateIndex
CREATE INDEX "token_usage_run_id_idx" ON "token_usage"("run_id");

-- CreateIndex
CREATE INDEX "guardrail_events_user_id_created_at_idx" ON "guardrail_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "guardrail_events_session_id_created_at_idx" ON "guardrail_events"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "guardrail_events_rule_created_at_idx" ON "guardrail_events"("rule", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_session_id_created_at_idx" ON "agent_runs"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_turn_id_idx" ON "agent_runs"("turn_id");

-- ── Order invariants (PLAN §5/§9) ───────────────────────────────────────────
CREATE TRIGGER "orders_validate_insert" BEFORE INSERT ON "orders"
WHEN new."status" NOT IN ('placed', 'cancelled', 'shipped', 'delivered')
    OR new."source" NOT IN ('direct', 'cart')
    OR new."placed_by" NOT IN ('user', 'agent')
    OR new."total_cents" < 0
    OR new."currency" <> 'USD'
    OR length(trim(new."order_number")) = 0
    OR length(trim(new."idempotency_key")) = 0
    OR (new."cancelled_by" IS NOT NULL AND new."cancelled_by" NOT IN ('user', 'agent'))
    OR (new."status" = 'cancelled' AND new."cancelled_at" IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'orders invariant violated');
END;

CREATE TRIGGER "orders_validate_update" BEFORE UPDATE ON "orders"
WHEN new."status" NOT IN ('placed', 'cancelled', 'shipped', 'delivered')
    OR new."source" NOT IN ('direct', 'cart')
    OR new."placed_by" NOT IN ('user', 'agent')
    OR new."total_cents" < 0
    OR new."currency" <> 'USD'
    OR length(trim(new."order_number")) = 0
    OR length(trim(new."idempotency_key")) = 0
    OR (new."cancelled_by" IS NOT NULL AND new."cancelled_by" NOT IN ('user', 'agent'))
    OR (new."status" = 'cancelled' AND new."cancelled_at" IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'orders invariant violated');
END;

CREATE TRIGGER "order_items_validate_insert" BEFORE INSERT ON "order_items"
WHEN new."qty" <= 0 OR new."unit_price_cents" < 0
BEGIN
    SELECT RAISE(ABORT, 'order_items.qty must be > 0 and unit_price_cents >= 0');
END;

CREATE TRIGGER "order_items_validate_update" BEFORE UPDATE ON "order_items"
WHEN new."qty" <= 0 OR new."unit_price_cents" < 0
BEGIN
    SELECT RAISE(ABORT, 'order_items.qty must be > 0 and unit_price_cents >= 0');
END;

-- ── Chat session/message invariants (PLAN §5/§11) ───────────────────────────
CREATE TRIGGER "chat_sessions_kind_insert" BEFORE INSERT ON "chat_sessions"
WHEN new."kind" NOT IN ('rag', 'agent')
BEGIN
    SELECT RAISE(ABORT, 'chat_sessions.kind must be rag or agent');
END;

CREATE TRIGGER "chat_sessions_kind_update" BEFORE UPDATE ON "chat_sessions"
WHEN new."kind" NOT IN ('rag', 'agent')
BEGIN
    SELECT RAISE(ABORT, 'chat_sessions.kind must be rag or agent');
END;

CREATE TRIGGER "messages_validate_insert" BEFORE INSERT ON "messages"
WHEN new."role" NOT IN ('user', 'assistant', 'system', 'tool')
    OR new."status" NOT IN ('complete', 'error')
    OR new."seq" <= 0
    OR (new."client_message_id" IS NOT NULL AND length(trim(new."client_message_id")) = 0)
BEGIN
    SELECT RAISE(ABORT, 'messages invariant violated');
END;

CREATE TRIGGER "messages_validate_update" BEFORE UPDATE ON "messages"
WHEN new."role" NOT IN ('user', 'assistant', 'system', 'tool')
    OR new."status" NOT IN ('complete', 'error')
    OR new."seq" <= 0
    OR (new."client_message_id" IS NOT NULL AND length(trim(new."client_message_id")) = 0)
BEGIN
    SELECT RAISE(ABORT, 'messages invariant violated');
END;

-- ── Observability invariants (PLAN §5/§14) ──────────────────────────────────
CREATE TRIGGER "token_usage_validate_insert" BEFORE INSERT ON "token_usage"
WHEN new."kind" NOT IN ('router', 'guardrail', 'agent', 'rag', 'summarizer', 'embedding')
    OR new."input_tokens" < 0
    OR new."output_tokens" < 0
    OR new."latency_ms" < 0
    OR new."estimated" NOT IN (0, 1)
BEGIN
    SELECT RAISE(ABORT, 'token_usage invariant violated');
END;

CREATE TRIGGER "token_usage_validate_update" BEFORE UPDATE ON "token_usage"
WHEN new."kind" NOT IN ('router', 'guardrail', 'agent', 'rag', 'summarizer', 'embedding')
    OR new."input_tokens" < 0
    OR new."output_tokens" < 0
    OR new."latency_ms" < 0
    OR new."estimated" NOT IN (0, 1)
BEGIN
    SELECT RAISE(ABORT, 'token_usage invariant violated');
END;

CREATE TRIGGER "guardrail_events_validate_insert" BEFORE INSERT ON "guardrail_events"
WHEN length(trim(new."rule")) = 0
    OR length(trim(new."action")) = 0
    OR length(trim(new."request_id")) = 0
    OR (new."score" IS NOT NULL AND (new."score" < 0 OR new."score" > 1))
BEGIN
    SELECT RAISE(ABORT, 'guardrail_events invariant violated');
END;

CREATE TRIGGER "guardrail_events_validate_update" BEFORE UPDATE ON "guardrail_events"
WHEN length(trim(new."rule")) = 0
    OR length(trim(new."action")) = 0
    OR length(trim(new."request_id")) = 0
    OR (new."score" IS NOT NULL AND (new."score" < 0 OR new."score" > 1))
BEGIN
    SELECT RAISE(ABORT, 'guardrail_events invariant violated');
END;

CREATE TRIGGER "agent_runs_validate_insert" BEFORE INSERT ON "agent_runs"
WHEN new."status" NOT IN ('ok', 'error', 'blocked', 'limit')
    OR new."duration_ms" < 0
    OR length(trim(new."agent")) = 0
    OR length(trim(new."route")) = 0
    OR length(trim(new."model")) = 0
    OR length(trim(new."provider")) = 0
    OR length(trim(new."prompt_version")) = 0
BEGIN
    SELECT RAISE(ABORT, 'agent_runs invariant violated');
END;

CREATE TRIGGER "agent_runs_validate_update" BEFORE UPDATE ON "agent_runs"
WHEN new."status" NOT IN ('ok', 'error', 'blocked', 'limit')
    OR new."duration_ms" < 0
    OR length(trim(new."agent")) = 0
    OR length(trim(new."route")) = 0
    OR length(trim(new."model")) = 0
    OR length(trim(new."provider")) = 0
    OR length(trim(new."prompt_version")) = 0
BEGIN
    SELECT RAISE(ABORT, 'agent_runs invariant violated');
END;
