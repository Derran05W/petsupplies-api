# Subscribe & Save (subscriptions)

Authenticated customers can start Stripe-hosted **Checkout** sessions in **subscription** mode for recurring deliveries. Billing state is **canonical in Stripe**; the database holds a read model (`Subscription`) plus one `Order` row per paid subscription invoice (`invoice.paid`). Phase 16 does **not** run a scheduler for reminders — see **Upcoming delivery reminders** below.

---

## API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/subscriptions` | Yes | Start Subscribe & Save Checkout; returns `{ url, checkoutSessionId }`. |
| `GET` | `/users/me/subscriptions` | Yes | Paginated list (`page`, `limit`, optional `status`). Default sort `createdAt desc`. |
| `GET` | `/users/me/subscriptions/:id` | Yes | Single subscription (`:id` must match `^c[a-z0-9]{24}$`). |
| `PATCH` | `/users/me/subscriptions/:id` | Yes | Partial `{ quantity?, interval?, petId? }`. Empty body → `400 EMPTY_PATCH`. |
| `POST` | `/users/me/subscriptions/:id/pause` | Yes | Stripe `pause_collection: { behavior: 'void' }`. |
| `POST` | `/users/me/subscriptions/:id/resume` | Yes | Clears `pause_collection`. |
| `DELETE` | `/users/me/subscriptions/:id` | Yes | Schedules cancellation at period end (`cancel_at_period_end: true`). Returns **200** with the subscription body (not `204`). |
| `PATCH` | `/admin/products/:id/subscription` | Admin | Body **`{ subscriptionEligible: true }` only**. Idempotent pre-creation of four recurring Stripe Prices + `ProductSubscriptionPrice` rows. `{ subscriptionEligible: false }` → `400 NOT_SUPPORTED` (deferred). |

`userId` is never accepted from clients; it always comes from the JWT `sub`.

---

## Validation & errors

- **`POST /subscriptions` body**: `productId` and optional `petId` are **cuids** (`^c[a-z0-9]{24}$`). `quantity` is integer **1..99**. `interval` is one of `WEEK_2`, `WEEK_4`, `WEEK_8`, `WEEK_12`.
- **Cross-tenant access**: missing or not-owned subscription ids return **404** with message `SUBSCRIPTION_NOT_FOUND` — never **403**.
- **Capacity**: at most **25** subscriptions per user where `status ∈ { ACTIVE, PAUSED }`. Above that → `400 SUBSCRIPTIONS_LIMIT_REACHED`.
- **Discount stacking**: if the user’s cart has an active `discountId`, `POST /subscriptions` returns **`409 DISCOUNT_STACKING_NOT_ALLOWED`** (Phase 12 cart codes do not stack with Subscribe & Save).
- **Product rules**: creation requires `Product.active` and `Product.subscriptionEligible`. **`GET /users/me/subscriptions` still lists** subscriptions even if the product later becomes inactive (support visibility).
- **Pet ownership**: `petId`, when sent, must belong to the caller (`404 PET_NOT_FOUND` if missing / not owned).

---

## Stripe model

- **Checkout**: `mode: 'subscription'`, recurring **Price** per cart line, shared coupon **`subscribe-save-5pct`** (5% forever), `shipping_address_collection`, shipping options mirroring Phase 6 threshold logic for the **first** Checkout invoice.
- **Customer reuse**: `User.stripeCustomerId` is created lazily (`stripe.customers.create` with `metadata: { userId }`) and reused on later Checkout sessions (cart or subscription).
- **Prices**: Admin eligibility (`PATCH /admin/products/:id/subscription`) pre-creates **four** recurring Prices (2 / 4 / 8 / 12 week intervals, CAD, unit amount = catalog `Product.price`). Mapped in `ProductSubscriptionPrice` (`@@unique([productId, interval])`, `stripePriceId @unique`).
- **Webhook events** (same `/webhooks/stripe` endpoint): extend handlers for `checkout.session.completed` (**subscription** branch), `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Existing payment Checkout behavior is unchanged.

---

## Local read model

- **`Subscription`**: created/updated from Stripe webhooks (`syncSubscriptionFromStripe`). `status` is `ACTIVE`, `PAUSED` (Stripe `pause_collection` set), or `CANCELLED`. `nextDeliveryAt` tracks Stripe `current_period_end`. Optional `petId` uses **`ON DELETE SET NULL`** on `Pet`.
- **Pause / resume**: Pause uses Stripe **`pause_collection: { behavior: 'void' }`** (no backlog). Resume clears pause.
- **Customer cancel**: `DELETE /users/me/subscriptions/:id` sets **`cancel_at_period_end`** only; status stays **`ACTIVE`** until Stripe emits **`customer.subscription.deleted`** (then `CANCELLED`). **`cancelAtPeriodEnd` is not stored separately** — use `nextDeliveryAt` in the response for “cancels on” UX.
- **Skip-next shipment**: **not implemented** in Phase 16 (Stripe has no single-purpose primitive; would need schedules/manual invoicing later).

---

## Orders from renewals (`invoice.paid`)

- One **`Order`** per Stripe invoice id, idempotent on **`Order.subscriptionInvoiceId`** (`@unique`).
- **Shipping / tax snapshot**: renewal orders use **`shippingCents = 0`** and **`taxCents = 0`** (renewals are modeled as free shipping; first Checkout shipment still follows Phase 6 shipping rules).
- **Totals**: Prefer Stripe **`amount_paid`** when present; derive **`discountCents`** from catalog subtotal vs paid amount; fallback uses `discountPercent` on the local subscription row.
- **Stock**: decrement **only** inside `invoice.paid` handling using **`product.updateMany({ where: { id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } })`** in a **`prisma.$transaction`**. If **`count === 0`**, the order is **`CANCELLED`**, logs **`[subscription_oversold_incident]`** (ids + quantity only), sends **`subscriptionPaymentIssue`** email, and **does not** cancel the Stripe subscription (Stripe retries / next cycle can recover).

---

## Payment failures (`invoice.payment_failed`)

Logged with **internal ids + op + event type** only; sends **`subscriptionPaymentIssue`**; **does not** auto-cancel the subscription (Stripe dunning handles retries).

---

## Email & Phase 17 boundary

- Templates live in **`src/services/emailTemplates.ts`** (`subscriptionUpcomingDelivery`, `subscriptionPaymentIssue`).
- **`sendUpcomingDeliveryReminder`** and **`sendSubscriptionPaymentIssue`** live in **`emailService.ts`**.
- **`sendUpcomingDeliveryRemindersDue`** scans due **`ACTIVE`** subscriptions and sends reminders when called — **Phase 17** owns the cron that invokes it.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Checkout succeeds but no local `Subscription` | Webhook delivery / signing secret; `checkout.session.completed` registered; logs for subscription sync skip reasons. |
| Duplicate `invoice.paid` deliveries | Should **not** create a second order — rely on `subscriptionInvoiceId` uniqueness + handler idempotency. |
| Missing recurring Prices | Run admin **`PATCH .../subscription`** again (idempotent); verify four `ProductSubscriptionPrice` rows. |
| Orphan Stripe Prices/Coupons | Dashboard cleanup if DB write failed mid-flight (same pattern as Phase 12 orphan coupons). |

---

## Logging policy

Operational logs include **internal ids**, **`op`**, and **Stripe event type** where relevant. Do **not** log Stripe customer ids, invoice payloads, payment methods, raw JWTs/signatures, email bodies, or shipping/PII fields.
