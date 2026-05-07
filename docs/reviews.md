# Product reviews (Phase 13)

## Overview

Authenticated customers who have completed an eligible purchase for a product may leave **one** review per product (`rating`, `body`, optional `title`). Aggregates `Product.avgRating` and `Product.reviewCount` are recomputed **inside the same database transaction** as every create, update, or delete, immediately after acquiring a **`SELECT … FOR UPDATE` row lock** on the product. Public clients can list reviews for a product and see aggregate fields on product list/detail responses.

## Validation rules

| Field    | Rule |
| -------- | ---- |
| `rating` | Integer **1–5** (inclusive). |
| `body`   | Required string, **1–2000** characters after trim. |
| `title`  | Optional; when present, **1–120** characters after trim. |

- Surrounding whitespace is trimmed on `body` / `title`.
- The API does **not** strip HTML or escape markup on input; clients must render safely (e.g. React text nodes, `textContent`).
- `PATCH /reviews/:id` accepts only `rating`, `title`, and `body` (at least one required). **`verified` is not accepted** and is never updated by `PATCH`.

## Verified-purchase semantics (snapshotted `verified`)

- On **create**, the service checks for an `OrderItem` whose order belongs to the user and has status **`PAID`**, **`SHIPPED`**, or **`FULFILLED`**.
- **`PENDING`** and **`CANCELLED`** orders do **not** qualify.
- If no qualifying line item exists, the API responds with **403** and message **`PURCHASE_REQUIRED`**.
- On success, **`Review.verified`** is stored as **`true`** (the check just succeeded). It is **not** recomputed on read or on `PATCH`.
- Refund-driven changes to `verified` are **deferred to Phase 22** (returns/refunds); there is no `Refund` model in this phase.

## Aggregate behavior

- After each review **create**, **update**, or **delete**, `recomputeProductAggregates` runs in the same transaction:
  - `tx.review.aggregate` for `_avg.rating` and `_count._all`.
  - `Product.reviewCount` is set to the count.
  - If count is **0**, **`avgRating`** is set to **`null`**; otherwise it is set to Prisma’s average (PostgreSQL `AVG` over integers).
- Recompute is **idempotent** if run again with no intervening review changes.
- No async job: consistency is **transactional** only.

## Sort options

**Review list** (`GET /products/:slug/reviews`):

- `newest` (default), `oldest`, `rating_desc`, `rating_asc`.

**Product list** (`GET /products`):

- Existing sorts unchanged; added: `rating_desc`, `rating_asc` on **`Product.avgRating`**, **`NULLS LAST`** (unrated products do not float to the top of `rating_desc`).

Full-text search (`?q=`) **composes** with `sort=rating_desc` / `rating_asc` in both the raw SQL step and the hydration `findMany` order.

## One review per user per product

- Enforced by **`@@unique([productId, userId])`** on `Review`.
- A duplicate create returns **409** with message **`ALREADY_REVIEWED`** (including race losses surfaced as **P2002**).

## API surface

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/products/:slug/reviews` | Yes | Creates review; 403 / 409 / 404 as above. |
| `GET` | `/products/:slug/reviews` | No | Paginated `{ data, page, limit, total, totalPages }`; `limit` max **100**. |
| `PATCH` | `/reviews/:id` | Yes | Owner only; **403** `NOT_OWNER` / **404** `NOT_FOUND`. |
| `DELETE` | `/reviews/:id` | Yes | Hard delete; owner only; **204** on success. |

Product **`GET /products`** and **`GET /products/:slug`** responses include **`avgRating`** (`number | null`) and **`reviewCount`** (`number`).

## Safe logging policy

Structured logs use **identifiers only** (e.g. `reviewId`, `productId`, `userId`, `op`, coarse `reason`). **Never** log review `body`, `title`, or end-user email.

## Troubleshooting

| Symptom | Likelihood |
| ------- | ---------- |
| **`avgRating` / `reviewCount` look wrong after a write** | Should not happen if transactions commit; check for manual SQL drift or partial migration. Reseed or fix data offline; normal writes recompute. |
| **409 on second POST** | Expected: one review per user per product. |
| **403 `PURCHASE_REQUIRED`** | User has no **PAID/SHIPPED/FULFILLED** order line for that product. |

## Deferred

- Helpful-vote sort and ranking.
- Refund-driven `verified` revocation (**Phase 22**).
- Moderation, profanity filtering, admin review endpoints.
- Global rate limiting on `POST` (no rate-limit middleware in this repo yet).
- Database `CHECK (rating BETWEEN 1 AND 5)` (Prisma schema has no `@@check`; bounds enforced in Zod + service + tests).
