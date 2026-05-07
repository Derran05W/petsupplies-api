# Wishlist (Phase 14)

## Overview

Authenticated customers can save products under **`/users/me/wishlist`**. Each user has **at most one edge per product**, enforced by `@@unique([userId, productId])`. List responses include a **live product snapshot** (including **images**) and **`active` status**—wishlists intentionally keep **inactive** catalog rows so merchandising/back-in-stock flows can treat them as durable interest (**Phase 18**+) without reserving stock (**Phase 14** touches **no inventory** logic).

## Validation rules

| Surface | Rules |
| ------- | ----- |
| `POST` body | JSON object **`{ productId }` only**, `.strict()` (unknown keys **400**). `productId` required, non-empty string. |
| `GET` query | `page`: positive integer (`coerce`; default **1**); `limit`: **1–100** integer (`coerce`; default **20**); `sort`: **`newest`** (default) or **`oldest`**. |
| `DELETE` param | `productId`: **Prisma `cuid` shape** (**25 lowercase** `c[a-z0-9]{24}`)—invalid params **400** before mutation. |

- **Money**: `product.price` is **`Product.price` `Int`** and is stored/measured in **cents**, matching `cartService` / live product payloads (never floats).
- All endpoints derive **`userId` from JWT `sub`** (`auth` middleware); never accept **`userId` in URL/body/query**.

## Idempotent add semantics

- First **`POST`** for a `(user_id, product_id)` succeeds with **201**.
- Repeated **`POST`** for the same pair returns **200** with the existing row (**no 409**)—the database unique constraint is the race-safe backstop; **`P2002` is swallowed** inside the service and mapped to `{ created: false }` internally.
- **Re-add no-op does not mutate `addedAt`;** callers distinguish first-add vs re-add using **HTTP status only**, not JSON flags.

## Inactive-product behavior

- **`POST`** requires the **product exists** (**404 `NOT_FOUND`** if missing); `active === false` is **allowed**.
- **`GET`** returns inactive products embedded with **`"active": false`** so storefronts may grey out/disable buy paths while keeping the bookmark visible.

## Capacity cap

- Soft limit: **≤ 500 rows per user**. If **`count(where: { userId }) ≥ 500`** before **`create`**, the API returns **400** with **`WISHLIST_FULL`**—this guards abuse; concurrency may briefly violate the cap by a row whereas **`@@unique` still dedupes** concurrent duplicate adds.

## API surface

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/users/me/wishlist` | Yes | Paginated `{ data, page, limit, total, totalPages }`. |
| `POST` | `/users/me/wishlist` | Yes | **201** first add / **200** duplicate; payloads mirror list rows (+ product snapshot). |
| `DELETE` | `/users/me/wishlist/:productId` | Yes | Targets `(user_id, product_id)`; **204** even when missing—**never** exposes wishlist PKs in URLs. |

## Safe logging policy

Structured **`console.info(JSON.stringify(...))`** lines include **identifiers + coarse enums** (`userId`, `productId`, **`op`** `add`|`remove`, optional **`reason`**, e.g. **`duplicate_noop`**). Never log **`email`**, **product name/free text**, or request bodies wholesale.

## Troubleshooting

| Symptom | Likelihood |
| ------- | ---------- |
| **400 `WISHLIST_FULL`** | Genuine cap hit; prune items or escalate policy (rate limits deferred). |
| **404 `NOT_FOUND` on `POST`** | Product id typo or SKU removed; dormant wishlist edges survive until user/product cascades prune them. |
| **200 twice on duplicates** | By design (**idempotent UX** vs 409 friction). Frontend should treat **HTTP status**, not phantom JSON flags. |

## Deferred

- Back-in-stock alerting / transactional email fanout (**Phase 18**).
- Name/share multi-wishlists, merchandising pinning / sort-by-price.
- **`Product.wishlistCount`** or analytics dashboards (**Phase 21**+).
- Variant-level wishlists (**Phase 19**).
- Updating `addedAt` on intentional “pin” reorder flows (**Phase 21**+).

