# API endpoints

Single inventory of HTTP routes mounted by [`src/app.ts`](../src/app.ts). Base URL is your API origin (e.g. Railway service URL). Unless noted, responses are JSON.

**Customer storefront:** use everything except `/admin/*`, `/webhooks/*`, and `/jobs/*`.  
**Admin UI:** use `/admin/*` with an authenticated user whose `public."User".role` is `ADMIN`. On first admin request, the API may promote the row from JWT `app_metadata.role === 'ADMIN'` (not `user_metadata`).  
**Frontend never calls:** Stripe webhook and cron job endpoints (server-to-server only).

---

## Legend

| Column   | Meaning                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth** | `none` — public; `user` — `Authorization: Bearer <Supabase JWT>`; `admin` — JWT + admin role; `stripe` — Stripe signature on raw body; `cron` — `Authorization: Bearer <CRON_BEARER_TOKEN>` |

---

## Health

| Method | Path      | Auth |
| ------ | --------- | ---- |
| `GET`  | `/health` | none |

---

## Webhooks (server only)

| Method | Path               | Auth                             |
| ------ | ------------------ | -------------------------------- |
| `POST` | `/webhooks/stripe` | Stripe `stripe-signature` header |

---

## Products & catalog reviews

Mounted at `/products`. Listing and detail are public; creating a review requires login.

| Method | Path                      | Auth |
| ------ | ------------------------- | ---- |
| `GET`  | `/products`               | none |
| `GET`  | `/products/:slug`         | none |
| `GET`  | `/products/:slug/reviews` | none |
| `POST` | `/products/:slug/reviews` | user |

---

## Cart

Mounted at `/cart`. All routes require auth.

| Method   | Path              | Auth |
| -------- | ----------------- | ---- |
| `GET`    | `/cart`           | user |
| `POST`   | `/cart/items`     | user |
| `PATCH`  | `/cart/items/:id` | user |
| `DELETE` | `/cart/items/:id` | user |
| `POST`   | `/cart/discount`  | user |
| `DELETE` | `/cart/discount`  | user |
| `DELETE` | `/cart`           | user |

---

## Checkout & shipping

| Method | Path                | Auth |
| ------ | ------------------- | ---- |
| `POST` | `/checkout/session` | user |
| `POST` | `/shipping/quote`   | user |

---

## Subscribe & Save (checkout)

Mounted at `/subscriptions` — creates a Stripe subscription checkout for the authenticated user.

| Method | Path             | Auth |
| ------ | ---------------- | ---- |
| `POST` | `/subscriptions` | user |

---

## Orders (customer)

Mounted at `/orders`.

| Method | Path          | Auth |
| ------ | ------------- | ---- |
| `GET`  | `/orders`     | user |
| `GET`  | `/orders/:id` | user |

---

## Reviews (authenticated user’s edits)

Mounted at `/reviews` — update/delete **your** review by review id (not product slug).

| Method   | Path           | Auth |
| -------- | -------------- | ---- |
| `PATCH`  | `/reviews/:id` | user |
| `DELETE` | `/reviews/:id` | user |

---

## Current user profile

Mounted at `/users`.

| Method  | Path        | Auth |
| ------- | ----------- | ---- |
| `GET`   | `/users/me` | user |
| `PATCH` | `/users/me` | user |

---

## Saved addresses

Mounted at `/users/me/addresses`.

| Method   | Path                              | Auth |
| -------- | --------------------------------- | ---- |
| `GET`    | `/users/me/addresses`             | user |
| `POST`   | `/users/me/addresses`             | user |
| `PATCH`  | `/users/me/addresses/:id`         | user |
| `DELETE` | `/users/me/addresses/:id`         | user |
| `POST`   | `/users/me/addresses/:id/default` | user |

---

## Wishlist

Mounted at `/users/me/wishlist`.

| Method   | Path                            | Auth |
| -------- | ------------------------------- | ---- |
| `GET`    | `/users/me/wishlist`            | user |
| `POST`   | `/users/me/wishlist`            | user |
| `DELETE` | `/users/me/wishlist/:productId` | user |

---

## Back-in-stock alerts

Mounted at `/users/me/stock-alerts`.

| Method   | Path                                | Auth |
| -------- | ----------------------------------- | ---- |
| `GET`    | `/users/me/stock-alerts`            | user |
| `POST`   | `/users/me/stock-alerts`            | user |
| `DELETE` | `/users/me/stock-alerts/:productId` | user |

---

## Pet profiles

Mounted at `/users/me/pets`.

| Method   | Path                 | Auth |
| -------- | -------------------- | ---- |
| `GET`    | `/users/me/pets`     | user |
| `GET`    | `/users/me/pets/:id` | user |
| `POST`   | `/users/me/pets`     | user |
| `PATCH`  | `/users/me/pets/:id` | user |
| `DELETE` | `/users/me/pets/:id` | user |

---

## Subscriptions (customer lifecycle)

Mounted at `/users/me/subscriptions`.

| Method   | Path                                 | Auth |
| -------- | ------------------------------------ | ---- |
| `GET`    | `/users/me/subscriptions`            | user |
| `GET`    | `/users/me/subscriptions/:id`        | user |
| `PATCH`  | `/users/me/subscriptions/:id`        | user |
| `POST`   | `/users/me/subscriptions/:id/pause`  | user |
| `POST`   | `/users/me/subscriptions/:id/resume` | user |
| `DELETE` | `/users/me/subscriptions/:id`        | user |

---

## Scheduled jobs (cron / infra)

Mounted at `/jobs`. Not for browser clients.

| Method | Path                          | Auth |
| ------ | ----------------------------- | ---- |
| `POST` | `/jobs/run/abandoned-cart`    | cron |
| `POST` | `/jobs/run/upcoming-delivery` | cron |
| `POST` | `/jobs/run/back-in-stock`     | cron |

Unknown `:name` returns `404`.

---

## Admin

All routes under `/admin` require **admin** auth (`auth` + `adminOnly`).

### Analytics (`/admin/analytics`)

| Method | Path                                  | Auth  |
| ------ | ------------------------------------- | ----- |
| `GET`  | `/admin/analytics/overview`           | admin |
| `GET`  | `/admin/analytics/revenue-timeseries` | admin |
| `GET`  | `/admin/analytics/products/top`       | admin |
| `GET`  | `/admin/analytics/products/low-stock` | admin |
| `GET`  | `/admin/analytics/subscriptions`      | admin |
| `GET`  | `/admin/analytics/discounts`          | admin |

### Customers (`/admin/customers`)

| Method | Path                                 | Auth  |
| ------ | ------------------------------------ | ----- |
| `GET`  | `/admin/customers`                   | admin |
| `GET`  | `/admin/customers/:id`               | admin |
| `GET`  | `/admin/customers/:id/orders`        | admin |
| `GET`  | `/admin/customers/:id/subscriptions` | admin |

### Fulfillment (`/admin/fulfillment`)

| Method | Path                           | Auth  |
| ------ | ------------------------------ | ----- |
| `GET`  | `/admin/fulfillment/queue`     | admin |
| `POST` | `/admin/fulfillment/bulk-ship` | admin |

### Products — Phase 26 CRUD & images (`/admin/products`)

| Method   | Path                                  | Auth  |
| -------- | ------------------------------------- | ----- |
| `POST`   | `/admin/products/images/upload-url`   | admin |
| `GET`    | `/admin/products`                     | admin |
| `POST`   | `/admin/products`                     | admin |
| `GET`    | `/admin/products/:id`                 | admin |
| `PATCH`  | `/admin/products/:id`                 | admin |
| `DELETE` | `/admin/products/:id`                 | admin |
| `POST`   | `/admin/products/:id/images`          | admin |
| `PATCH`  | `/admin/products/:id/images/reorder`  | admin |
| `PATCH`  | `/admin/products/:id/images/:imageId` | admin |
| `DELETE` | `/admin/products/:id/images/:imageId` | admin |

### Product shipping package & Subscribe & Save setup

Same `/admin/products` prefix; implemented on [`adminRouter`](../src/routes/admin.ts) (not nested router).

| Method  | Path                               | Auth  |
| ------- | ---------------------------------- | ----- |
| `PATCH` | `/admin/products/:id/package`      | admin |
| `PATCH` | `/admin/products/:id/subscription` | admin |

### Orders & discounts (`/admin`)

| Method  | Path                         | Auth  |
| ------- | ---------------------------- | ----- |
| `GET`   | `/admin/orders`              | admin |
| `GET`   | `/admin/orders/:id`          | admin |
| `PATCH` | `/admin/orders/:id/status`   | admin |
| `PATCH` | `/admin/orders/:id/tracking` | admin |
| `POST`  | `/admin/discounts`           | admin |
| `GET`   | `/admin/discounts`           | admin |

---

## Related docs

Feature-focused references (schemas, smoke tests, policies):

- [`docs/admin-products.md`](./admin-products.md) — admin catalog & Storage uploads
- [`docs/admin-dashboard.md`](./admin-dashboard.md) — analytics queries
- [`docs/discounts.md`](./discounts.md), [`docs/subscriptions.md`](./subscriptions.md), [`docs/shipping.md`](./shipping.md), [`docs/reviews.md`](./reviews.md), [`docs/wishlist.md`](./wishlist.md), [`docs/pets.md`](./pets.md), [`docs/cron.md`](./cron.md)

---

## Maintaining this file

When adding or removing routes under [`src/routes/`](../src/routes/) or changing mounts in [`src/app.ts`](../src/app.ts), update this document in the same PR.
