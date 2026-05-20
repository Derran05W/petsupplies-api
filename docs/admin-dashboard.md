# Extended admin dashboard (Phase 21)

Authenticated **admin JWT** endpoints for operational KPIs, customer drill-down, and fulfillment workflow helpers.

**Auth**: every path requires **`Authorization: Bearer`** (Supabase HS256 JWT) **`+`** `adminOnly` middleware. Runtime access uses `public."User".role === 'ADMIN'`. If the JWT has `app_metadata.role === 'ADMIN'` but the row is still `CUSTOMER`, the first request promotes the row (self-heal); `user_metadata.role` alone does not promote. See [`deployment.md`](./deployment.md#promote-an-admin-per-env).

**Money**: totals and line metrics are \*\*`Int` cents`.

**Stripe**: endpoints added in Phase 21 must **not** return `stripeSessionId` / `stripePaymentIntent`. The legacy `GET /admin/orders/:id` response is unchanged.

**Pagination**: lists use **`{ data, page, limit, total, totalPages }`** unless noted. Default `page = 1`, `limit = 20`; **`limit`** is capped **`100`** (top-products uses `limit ≤ 50` instead).

---

## Analytics — `GET /admin/analytics/*`

| Route                     | Query                                                 | Behavior                                                                                                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /overview`           | `from`, `to` optional                                 | Order counts (`byStatus`), paid-like revenue (**`PAID` + `SHIPPED` + `FULFILLED`**), `aovCents`. Dates default ~**30-day** trailing window ending **now** when omitted. Max span **366** days (`400`).                                              |
| `GET /revenue-timeseries` | `from`,`to`; `granularity=day \| week`                | Buckets summed **paid-like** totals + order counts (`$queryRaw` + `date_trunc`).                                                                                                                                                                    |
| `GET /products/top`       | same range + **`limit`** (≤ 50, default 20)           | **`OrderItem`** roll-up by product for paid-like orders (`$queryRaw`). No pagination envelope.                                                                                                                                                      |
| `GET /products/low-stock` | **`page`,`limit`; `threshold` (0–100, default `10`)** | Products with `stock <= threshold`, **`stock ascending`**.                                                                                                                                                                                          |
| `GET /subscriptions`      | —                                                     | **`Subscription`** counts **`byStatus`**, plus ACTIVE upcoming delivery counts (**7d**, **30d** windows vs `nextDeliveryAt`).                                                                                                                       |
| `GET /discounts`          | `from`,`to` optional                                  | Rows per local `Discount` with `usedCount`, `maxRedemptions`, **redemptions in range**, **`revenueImpactCents`** (**sum paid-like `Order.discountCents` in range**, grouped by coupon). Responses include **codes** (**admin-only**); never logged. |

**Logging**: reuse existing rules — **discount codes must not appear in logs** (`docs/discounts.md`). Analytics must not emit raw emails in structured logs.

---

## Customers — `/admin/customers`

| Route                    | Behavior                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                  | Filter optional `role`, optional **`email` substring** (`contains`, case-insensitive). Service rejects **`email` shorter than two characters with `400`** to avoid worthless scans. |
| `GET /:id`               | Profile + relational `_counts` (**orders / subscriptions / addresses / reviews / wishlist / pets**) + **`lifetimeValueCents` (paid-like sum)** + `lastOrderAt`.                     |
| `GET /:id/orders`        | Delegates **`orderService.listAdminOrders`** with `userId` filter (same pagination envelope).                                                                                       |
| `GET /:id/subscriptions` | Paginated subscription rows (**includes Stripe subscription + price identifiers** admins need operator-side — never payment-method objects).                                        |

---

## Fulfillment helpers

| Route                         | Body / query                                                                  | Behavior                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /fulfillment/queue`      | `page`,`limit`; optional **`from`,`to`**, **`status`**                        | Defaults **`status = PAID`**, **`createdAt ascending`** (**oldest first**). Omits Stripe fields per record.                                                                                             |
| `POST /fulfillment/bulk-ship` | **`{ items: [{ orderId, trackingNumber, carrier }] }`** length **1..50** each | Sequential calls **`orderService.updateAdminOrderStatus(…)`** (**same transitions + emails**). Returns **`200`** with **`{ results:[{ orderId, ok, status?, error? }] }`**. Partial failures tolerated. |
| `PATCH /orders/:id/tracking`  | **`{ trackingNumber, carrier }`** only                                        | Allowed only **`SHIPPED`** or **`FULFILLED`**; updates fields **without re-sending** shipping notifications. **`409`** otherwise.                                                                       |

**CSV uploads / importer**: explicitly **not** implemented (defer).

---

## Performance & DB notes

Heavy analytics intentionally **clamp** selectable windows (**366-day max span** enforced in service). **`OrderItem`** top-sellers path runs parameterized `$queryRaw` joins; consider `@@index([productId])` on `OrderItem` only after profiling exposes slow aggregates.
