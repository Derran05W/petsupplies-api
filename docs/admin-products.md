# Admin Product Management

Phase 26 — full CRUD over the product catalog for admin users, with image uploads via Supabase Storage presigned URLs. After setup, the business owner can manage everything without a developer.

---

## Supabase Storage setup (one-time per environment)

**Option A — SQL (recommended):** In Supabase **SQL Editor**, run [`supabase/storage/product-images-bucket.sql`](../supabase/storage/product-images-bucket.sql). This creates the `product-images` public bucket and a public-read policy.

**Option B — Dashboard:**

1. Open the Supabase dashboard for the environment (staging or production).
2. Go to **Storage → Buckets → New bucket**.
3. Name it exactly `product-images` (or whatever you set in `SUPABASE_STORAGE_BUCKET`).
4. Enable **Public bucket** (product images are publicly readable).
5. Under **Policies**, ensure only the service role can write (the default RLS policy restricts writes to authenticated service-role requests, which is what the API uses).

A **502** on `POST /admin/products/images/upload-url` with `The related resource does not exist` means this bucket is missing in the project pointed at by `SUPABASE_URL` in petsupplies-api `.env`.

No other storage configuration is required.

---

## Environment variables

| Variable                           | Default          | Description                                     |
| ---------------------------------- | ---------------- | ----------------------------------------------- |
| `SUPABASE_STORAGE_BUCKET`          | `product-images` | Supabase Storage bucket name                    |
| `SUPABASE_PRODUCT_IMAGE_MAX_BYTES` | `5000000`        | Max image size to communicate to clients (5 MB) |

The API reuses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (already required for auth) to create signed upload URLs.

---

## Image upload flow

The API never receives raw image bytes — the browser uploads directly to Supabase Storage using a short-lived presigned URL.

```
Admin UI                    petsupplies-api                Supabase Storage
   │                               │                              │
   │  POST /admin/products/        │                              │
   │     images/upload-url         │                              │
   │  { filename, contentType }    │                              │
   │──────────────────────────────>│                              │
   │                               │  createSignedUploadUrl()    │
   │                               │─────────────────────────────>│
   │                               │<─────────────────────────────│
   │<──────────────────────────────│                              │
   │  { uploadUrl, objectKey,      │                              │
   │    publicUrl, maxBytes }       │                              │
   │                               │                              │
   │  PUT uploadUrl (raw bytes)    │                              │
   │──────────────────────────────────────────────────────────────>
   │                               │                              │
   │  POST /admin/products/:id/images                             │
   │  { url: publicUrl, ... }      │                              │
   │──────────────────────────────>│                              │
   │<──────────────────────────────│                              │
   │  ProductImage row             │                              │
```

Signed upload URLs expire after 2 hours (Supabase default). The admin UI should request a fresh URL each time an upload is initiated.

---

## Allowed image types

`image/jpeg`, `image/png`, `image/webp`, `image/gif`

Requests with any other `contentType` are rejected with HTTP 400 before reaching Supabase.

---

## API reference

All endpoints require a valid admin JWT (`Authorization: Bearer <token>`). Non-admin users receive HTTP 403.

### Products

| Method   | Path                  | Description                              |
| -------- | --------------------- | ---------------------------------------- |
| `GET`    | `/admin/products`     | List all products (including inactive)   |
| `GET`    | `/admin/products/:id` | Get single product by ID                 |
| `POST`   | `/admin/products`     | Create a new product                     |
| `PATCH`  | `/admin/products/:id` | Partially update any product field       |
| `DELETE` | `/admin/products/:id` | Delete product (soft or hard, see below) |

#### GET /admin/products query params

| Param      | Type           | Description                                                                                        |
| ---------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `page`     | number         | Page number (default 1)                                                                            |
| `limit`    | number         | Results per page (max 100, default 20)                                                             |
| `q`        | string         | Search name and description (case-insensitive)                                                     |
| `category` | enum           | Filter by category (`DOG`, `CAT`, `FISH`, `BIRD`, `SMALL_PET`, `REPTILE`, `ACCESSORIES`, `HEALTH`) |
| `active`   | `true`/`false` | Filter by active status (omit for all)                                                             |

#### POST /admin/products body

```json
{
  "name": "Royal Canin Adult",
  "description": "Complete nutrition for adult dogs.",
  "price": 5499,
  "category": "DOG",
  "stock": 100,
  "active": true,
  "slug": "royal-canin-adult",
  "tags": ["dry-food", "premium"],
  "imageUrl": "https://example.com/primary.jpg",
  "weightGrams": 2000,
  "lengthCm": 30,
  "widthCm": 20,
  "heightCm": 15,
  "shipsSeparately": false
}
```

- `slug` is optional — auto-generated from name if omitted (e.g. `royal-canin-adult`). If the slug already exists, a numeric suffix is appended (`royal-canin-adult-1`).
- `price` is in **cents** (integer). `5499` = $54.99.
- `tags` is a string array of up to 30 tags, each up to 40 characters.
- All shipping dimension fields (`weightGrams`, `lengthCm`, `widthCm`, `heightCm`) are optional and used for Canada Post rate calculation.

#### Subscribe & Save (`subscriptionEligible`)

Do **not** set `subscriptionEligible` on `POST` / `PATCH /admin/products`: those bodies are strict and reject unknown keys for safety.

To enable Subscribe & Save on a product, call **`PATCH /admin/products/:id/subscription`** with `{ "subscriptionEligible": true }`. That endpoint creates Stripe recurring prices and `ProductSubscriptionPrice` rows and sets the flag. Turning the flag on via general CRUD would skip Stripe setup and cause checkout/subscribe failures (`SUBSCRIPTION_PRICE_MISSING`).

Disabling subscriptions cleanly (deactivating Stripe prices and DB rows) is not handled by this API yet — see roadmap.

#### PATCH /admin/products/:id body

Any subset of the create body fields. Only supplied fields are updated.

Changing `slug` on a product with existing orders is safe (order history references product by ID, not slug), but will break external SEO links if the product is indexed.

#### DELETE /admin/products/:id response

```json
{ "deleted": "soft" }
```

or

```json
{ "deleted": "hard" }
```

**Soft delete** (`active = false`) is used when the product appears in any `OrderItem` or active `Subscription`. The product remains in the database to preserve order history, but is hidden from all public endpoints.

**Hard delete** (permanent) is used when no orders or subscriptions reference the product. All related `ProductImage`, `CartItem`, `WishlistItem`, `StockAlert`, and `Review` rows are cascade-deleted.

**Package dimensions**: You can set `weightGrams`, `lengthCm`, `widthCm`, `heightCm`, and `shipsSeparately` either via **`PATCH /admin/products/:id`** (partial body) or **`PATCH /admin/products/:id/package`**. Both update the same columns; use whichever fits your admin UI.

---

### Image management

| Method   | Path                                  | Description                           |
| -------- | ------------------------------------- | ------------------------------------- |
| `POST`   | `/admin/products/images/upload-url`   | Request a presigned upload URL        |
| `POST`   | `/admin/products/:id/images`          | Attach an image record after upload   |
| `PATCH`  | `/admin/products/:id/images/:imageId` | Edit altText, sortOrder, or isPrimary |
| `DELETE` | `/admin/products/:id/images/:imageId` | Remove an image                       |
| `PATCH`  | `/admin/products/:id/images/reorder`  | Bulk reorder images                   |

#### POST /admin/products/images/upload-url

```json
{ "filename": "hero.jpg", "contentType": "image/jpeg" }
```

Response:

```json
{
  "uploadUrl": "https://xxx.supabase.co/storage/v1/upload/sign/...",
  "token": "...",
  "objectKey": "products/<uuid>/<uuid>-hero.jpg",
  "publicUrl": "https://xxx.supabase.co/storage/v1/object/public/product-images/products/<uuid>/<uuid>-hero.jpg",
  "maxBytes": 5000000
}
```

Upload the file to `uploadUrl` with a `PUT` request and the raw bytes as the body. Then attach the image to the product using `publicUrl`.

#### POST /admin/products/:id/images

```json
{
  "url": "https://xxx.supabase.co/storage/v1/object/public/...",
  "altText": "Hero shot of Royal Canin bag",
  "sortOrder": 0,
  "isPrimary": true
}
```

Setting `isPrimary: true` atomically unsets the `isPrimary` flag on all other images for this product.

#### PATCH /admin/products/:id/images/reorder

```json
{
  "items": [
    { "id": "img_abc", "sortOrder": 0 },
    { "id": "img_def", "sortOrder": 1 }
  ]
}
```

All updates run in a single database transaction. Up to 50 images per call.

---

## Notes for the business owner

- **Product visibility**: Set `active: false` to hide a product from the storefront without deleting it. Use `DELETE` only when you're sure the product should be gone forever (products with order history can only be soft-deleted).
- **Image order**: The image with the lowest `sortOrder` value is shown first in the storefront. Use the reorder endpoint to change the display sequence.
- **Primary image**: The `isPrimary` image is used as the main thumbnail. Only one image per product can be primary.
- **Tags**: Free-form text labels (e.g. `sale`, `new-arrival`, `grain-free`). Used for filtering and merchandising by the frontend. Up to 30 tags, 40 characters each.
- **Shipping package**: Same fields apply whether you edit them on the general product PATCH or on **`PATCH /admin/products/:id/package`** — pick one workflow.
- **Subscribe & Save**: Enable only via **`PATCH /admin/products/:id/subscription`** after the product exists (never via general create/update).
- **Price is always in cents**: `$14.99` = `1499`. This avoids floating-point rounding issues.
