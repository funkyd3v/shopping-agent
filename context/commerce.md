# Cart and Orders

The user's chat/page request is the authorization. The code, not the LLM, decides whether a cart/order action is allowed.
Source: PLAN.md §9.

## Cart lifecycle

- One active cart per user, created lazily on first add; persists across sessions/logins.
- `/cart` and chat tools share `CartService`.
- `add_to_cart`: product exists, stock > 0, qty 1..5, lines ≤20; adding an existing product increments qty up to 5.
- `update_cart_item` sets qty (0 removes). `view_cart` returns current prices, subtotal, warnings.
- `price_at_add_cents` drives a "price changed" notice; checkout always uses current prices.
- Cart mutations are last-write-wins. Whole-turn retries are deduped by `clientMessageId`; individual tool retries are not idempotent (cart edits are reversible).
- **Implemented (Phase 5):** `/cart` and the cart agent share `CartService`; chat tools are `view_cart`, `add_to_cart`, `update_cart_item`. A deterministic resolver parses the user's own message (ordinals, names, SKUs, ids; quantity from text) before any write, and the tool rejects model arguments that disagree. A cart footer is appended to the reply. Another user's cart/item is inaccessible (404).

## Cart limits

- Max 20 distinct lines.
- Max 5 qty per line.
- A cart may hold a subtotal above the order limit; `/cart` warns and checkout refuses.
- Out-of-stock items may remain in the cart; checkout refuses them (all-or-nothing).

## Checkout (cart → order)

1. User clicks Checkout on `/cart` or asks the agent to check out.
2. `CheckoutService` opens one Prisma interactive transaction, guarded by the process-wide write mutex:
   - Load cart and items.
   - Recompute prices from `products` (ignore cart/model prices).
   - Enforce order limits and stock.
   - Create `orders` (`source='cart'`, `placed_by='user'` for page / `'agent'` for chat) and `order_items` with snapshots.
   - Decrement stock with conditional `updateMany` (`where: { id, stock: { gte: qty } }`); any zero count aborts.
   - Clear cart items; commit.
3. On failure (empty cart, out of stock, over limit, no address): roll back, keep cart unchanged, return a structured refusal (`code`, `limit`, `actual`, `allowed`, available quantities).
4. Idempotency key is server-derived from `(userId, kind='cart', clientMessageId or clientRequestId)` and checked before loading the cart. Do not include cart contents in the key. A retry returns the existing order, even if the cart is now empty.
5. Receipt is server-generated: order number, items, qty, unit price, total, status, cancel deadline, link.
- **Implemented (Phase 6):** `CheckoutService` resolves the cart inside one `OrderWriteService` transaction. Key is `cart:<clientRequestId>` (page) or `cart:<clientMessageId>` (chat). `/cart` Checkout reuses one browser-generated id across retries and navigates to `/orders/:id`.

## Direct order (`place_order`)

- Used for "order 2 of the second one" without the cart.
- Same resolver, limits, idempotency, transaction, stock decrement, and receipt as checkout.
- Key from `(userId, kind='direct', clientMessageId)`; retry returns the original order.
- `source='direct'`; does not touch the cart.
- One order per chat turn (`unique(user_id, turn_id)`); two orders require two turns.
- **Implemented (Phase 6):** `OrderService.placeDirect`; key is `direct:<clientMessageId>`. The `order` agent exposes `quote_order` / `place_order` / `checkout_cart` / `cancel_order`, each re-running `agent.order.ts` on the user's own message and rejecting model arguments that disagree. At most one order mutation runs per graph turn.

## Shared order limits

- Max order total: **$200.00**.
- Max quantity per item: **5**.
- Max agent orders per user per day: **5** (count all `placed_by='agent'` orders since UTC midnight, regardless of later cancellation).
- Max agent spend per user per day: **$500.00**.
- Stock must cover every line; no partial orders.
- One order per chat turn.
- Over-limit → structured refusal with `code`, `limit`, `actual`, `allowed`; the agent explains in chat.
- Deterministic order of checks: validate items → reprice → total limit → qty limit → daily count → daily spend → stock → write.

## Cancellation

- Via chat ("cancel order ORD-7F3K2") or the Cancel button on `/orders`.
- Allowed only while `status='placed'` and `cancellable_until` is in the future (default 30 minutes).
- One atomic `UPDATE ... WHERE id=? AND user_id=? AND status='placed' AND cancellable_until > now` returning row count; then restock all lines and set `cancelled_at`/`cancelled_by`. Row count 0 → structured refusal.
- Another user's order → 404 (not 403) to avoid enumeration.
- Idempotent: cancelling an already-cancelled order returns its current state (200).
- Receipt footer shows the new status and "cancelled".
- **Implemented (Phase 6):** `OrderWriteService.cancelOrder` does the guarded `updateMany` + restock in one transaction, is idempotent for already-cancelled orders, and returns 404 for another user's order. `POST /orders/:id/cancel` and the `/orders/:id` Cancel button both use it.

## Edge cases

- Empty cart checkout; out-of-stock line; cart over total/line/qty limit.
- Price changed between add and checkout (show new price; checkout uses it).
- Duplicate checkout / duplicate `place_order` (idempotency).
- Product not found; ambiguous reference; no prior list.
- Non-committal language → clarify, no side effect.
- No saved address → `NO_ADDRESS` (should not happen for registered users).
- Cancel after the window; cancel another user's order.
- Cross-turn injection via a malicious review → no order.
- Two tabs/concurrent runs on one session → second gets 409.
- Provider failure after commit → order stands; persisted receipt visible on reload.

## Audit and UX

- `placed_by='agent'` orders show an **AI assistant** badge; `source='cart'` shows "From cart".
- Every placed/refused/checked-out/cancelled order writes `guardrail_events` and a log line.
- `/cart` shows a demo banner: payments are mocked; do not enter real personal data.
- Orders store `turn_id`/`client_message_id` for provenance and `cart_id` when checked out from a cart.
- Cancel deadline is shown in local time in the footer and on the order page.
