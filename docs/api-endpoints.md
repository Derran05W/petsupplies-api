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

## Site settings (storefront)

Mounted at `/site`. Public reads for ISR / server components.

| Method | Path                      | Auth |
| ------ | ------------------------- | ---- |
| `GET`  | `/site/settings`          | none |
| `GET`  | `/site/featured-products` | none |
| `GET`  | `/site/nav`               | none |
| `GET`  | `/site/category-strip`    | none |
| `GET`  | `/site/pages/:slug`       | none |

- **`GET /site/settings`** — `SiteSettingsPublic` (shipping thresholds, brand, hero, `brandValues` array). Does not expose `updatedBy`.
- **`GET /site/featured-products`** — ordered array of public product list items (same shape as `GET /products` entries, including `inStock`).
- **`GET /site/nav`** — `{ header: NavLink[], footer: FooterColumn[] }` where each footer entry has `column` + `links`.
- **`GET /site/category-strip`** — ordered array of `{ id, label, imageUrl, href, position, isActive }`.
- **`GET /site/pages/:slug`** — `{ slug, title, bodyMarkdown, updatedAt }` when published; `404` if slug unknown, unpublished, or missing.

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

### Site settings (`/admin/site`)

| Method  | Path                               | Auth  |
| ------- | ---------------------------------- | ----- |
| `PATCH` | `/admin/site/settings`             | admin |
| `POST`  | `/admin/site/assets/upload-url`    | admin |
| `PUT`   | `/admin/site/featured-products`    | admin |
| `PUT`   | `/admin/site/nav/header`           | admin |
| `PUT`   | `/admin/site/nav/footer`           | admin |
| `PUT`   | `/admin/site/category-strip`       | admin |
| `GET`   | `/admin/site/pages`                | admin |
| `PUT`   | `/admin/site/pages/:slug`          | admin |
| `GET`   | `/admin/site/email-templates`      | admin |
| `GET`   | `/admin/site/email-templates/:key` | admin |
| `PUT`   | `/admin/site/email-templates/:key` | admin |

- **`PATCH /admin/site/settings`** — partial `SiteSettingsPublic` body. Revalidation tag: `site-settings`.
- **`PUT /admin/site/featured-products`** — `{ productIds: string[] }` (0–8 IDs). Replaces the curated set atomically; only active products allowed. Revalidation tag: `site-featured`.
- **`PUT /admin/site/nav/header`** — array of `{ label, href, position }`. Revalidation tag: `site-nav`.
- **`PUT /admin/site/nav/footer`** — array of `{ column: { key, label, position }, links: [...] }` (1–4 columns). Revalidation tag: `site-nav`.
- **`PUT /admin/site/category-strip`** — full array of `{ label, imageUrl?, href, position, isActive? }`. Revalidation tag: `site-category-strip`.
- **`GET /admin/site/pages`** — `{ pages: StaticPageAdmin[] }` with `isPublished` for all allow-listed slugs (`about`, `privacy`, `terms`, `shipping`, `returns`, `faq`).
- **`PUT /admin/site/pages/:slug`** — `{ title, bodyMarkdown, isPublished }`. Revalidation tag: `site-pages`.
- **`GET /admin/site/email-templates`** — `{ templates: { key, subject, preheader, updatedAt }[] }`.
- **`GET /admin/site/email-templates/:key`** — full template including `bodyMarkdown`.
- **`PUT /admin/site/email-templates/:key`** — `{ subject, preheader?, bodyMarkdown }` with Mustache-style `{{var}}` placeholders validated per key. Revalidation tag: `site-emails`.

See [`docs/site-assets.md`](./site-assets.md) for the `site-assets` bucket used by hero/category images.

### Orders & discounts (`/admin`)

| Method   | Path                         | Auth  |
| -------- | ---------------------------- | ----- |
| `GET`    | `/admin/orders`              | admin |
| `GET`    | `/admin/orders/:id`          | admin |
| `PATCH`  | `/admin/orders/:id/status`   | admin |
| `PATCH`  | `/admin/orders/:id/tracking` | admin |
| `POST`   | `/admin/discounts`           | admin |
| `GET`    | `/admin/discounts`           | admin |
| `PATCH`  | `/admin/discounts/:id`       | admin |
| `DELETE` | `/admin/discounts/:id`       | admin |

---

## Related docs

Feature-focused references (schemas, smoke tests, policies):

- [`docs/admin-products.md`](./admin-products.md) — admin catalog & Storage uploads
- [`docs/site-assets.md`](./site-assets.md) — homepage / site asset uploads
- [`docs/admin-dashboard.md`](./admin-dashboard.md) — analytics queries
- [`docs/discounts.md`](./discounts.md), [`docs/subscriptions.md`](./subscriptions.md), [`docs/shipping.md`](./shipping.md), [`docs/reviews.md`](./reviews.md), [`docs/wishlist.md`](./wishlist.md), [`docs/pets.md`](./pets.md), [`docs/cron.md`](./cron.md)

---

## Maintaining this file

When adding or removing routes under [`src/routes/`](../src/routes/) or changing mounts in [`src/app.ts`](../src/app.ts), update this document in the same PR.
