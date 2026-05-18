# Shipping (Phase 24 — Canada Post + fallback)

## Overview

- **Backend** computes shipping: cart subtotal still drives **free shipping above `FREE_SHIPPING_THRESHOLD_CENTS`** and **`FLAT_SHIPPING_CENTS`** below, unless live Canada Post rates succeed.
- **`POST /shipping/quote`** (auth): returns rate **options** with **`amountCents`** (integer) and **`selectionToken`** (HMAC-bound; see checkout).
- **`POST /checkout/session`**: optional JSON body `{ "shippingSelection": { ... } }`. Without `shippingSelection`, behavior matches pre–Phase 24 (flat / threshold / free-shipping coupon).
- **Fallback:** if Canada Post is unconfigured or errors/timeouts, quotes and checkout use the same flat/threshold/coupon rules as before.
- **Money:** all amounts are **cents** (`Int`).

## Canada Post configuration

See [deployment.md](./deployment.md) — **Canada Post** subsection for env vars. When **`CANADA_POST_API_KEY`**, **`CANADA_POST_CUSTOMER_NUMBER`**, and **`SHIP_FROM_POSTAL_CODE`** are not all usable together, the API skips live rating and uses fallback.

## Product package fields

Stored on **`Product`** (nullable unless noted):

- `weightGrams` — grams (admin bounds 1–50000).
- `lengthCm`, `widthCm`, `heightCm` — centimeters (1–200).
- `shipsSeparately` — boolean (default `false`); when `true`, that line is quoted as its own parcel; rates are merged by service code when possible.

**Admin:** `PATCH /admin/products/:id/package` with a JSON body containing one or more of the fields above.

Defaults for missing data: **`DEFAULT_PACKAGE_*`** env vars.

## Quote request

`POST /shipping/quote`

Body: either **`{ "addressId": "<cuid>" }`** (must belong to the user, `country` must be `CA`) **or** a full inline Canadian address:

- `line1`, `city`, `region`, `postalCode` (Canadian format), `country: "CA"`.

Do not send both `addressId` and inline fields.

**Response:** `{ "source": "canada_post" | "fallback", "options": [...], "expiresAt": "<ISO>" }`  
Each option includes `serviceCode`, `serviceName`, `carrier` (`CANADA_POST` | `FLAT`), `amountCents`, optional `estimatedDeliveryDays`, `selectionToken`.

When subtotal is above the free threshold or a valid **`FREE_SHIPPING`** coupon applies, options are a single free line (no Canada Post call).

## Checkout with selected rate

`POST /checkout/session` body:

```json
{
  "shippingSelection": {
    "selectionToken": "...",
    "serviceCode": "DOM.EP",
    "amountCents": 1299,
    "addressId": "cuid"
  }
}
```

Or the same **`selectionToken` / `serviceCode` / `amountCents`** with inline **`line1`, `city`, `region`, `postalCode`, `country: "CA"`** (must match the destination used when the token was minted).

Mismatch, expiry, or cart change → **`409 SHIPPING_RATE_STALE`**.

## Order snapshot

`Order` may include: `shipCarrier`, `shipServiceCode`, `shipServiceName`, `shipEstimatedDeliveryDays`, `shipQuoteSource` (`canada_post` | `fallback`), plus existing `shippingCents`. Legacy checkouts omit these quote fields (null).

## Logging & PII

Do not log full addresses or raw Canada Post responses. Use ids and coarse ops only.

## Subscriptions

Subscribe & Save **renewal** orders remain **`shippingCents = 0`**; Phase 24 does not call Canada Post for `invoice.paid`.

## Discount interaction

**`FREE_SHIPPING`** still forces zero shipping in cart preview, quote, and checkout when valid; live-rate **selection** with a non-zero amount is rejected if the session qualifies for free shipping (`409 SHIPPING_RATE_STALE`).
