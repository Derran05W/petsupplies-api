# Discount codes (Phase 12)

## Overview

Discounts are owned by the API. Codes are normalized, validated on cart apply, revalidated at Stripe Checkout session creation, and redeemed atomically when an order transitions `PENDING → PAID` via the Stripe webhook.

## Code normalization

- Trim surrounding whitespace, uppercase ASCII.
- Length 3–32 inclusive.
- Allowed characters: `A–Z`, `0–9`, `_`, `-` (full-string regex: `^[A-Z0-9_-]{3,32}$` after normalization).

Invalid input returns `INVALID_FORMAT` from validation; routes map this to HTTP `400`.

## Discount types

| Type            | `value` semantics                      | Product discount (`discountCents`)     | Shipping                          | Stripe                          |
| --------------- | -------------------------------------- | -------------------------------------- | --------------------------------- | ------------------------------- |
| `PERCENTAGE`    | 1–100 (percent of subtotal)            | `floor(subtotal * value / 100)`, capped at subtotal | Threshold-based unless overridden | Stripe Coupon + Checkout `discounts` |
| `FIXED`         | Cents off subtotal                     | `min(value, subtotal)`                 | Same as above                     | Stripe Coupon + Checkout `discounts` |
| `FREE_SHIPPING` | Must be `0`                            | `0`                                    | Forces zero-cost shipping option  | **No** Stripe coupon            |

Cart preview:

- `appliedDiscountCents`: product discount only.
- `shippingDiscountCents`: `FLAT_SHIPPING_CENTS` when a valid `FREE_SHIPPING` code removes paid shipping; otherwise `0`.
- `totalCents = subtotalCents - appliedDiscountCents + shippingCents`.

## Validation rules (`validate` / `validateById`)

Rejections: `NOT_FOUND`, `INACTIVE`, `NOT_STARTED`, `EXPIRED`, `MIN_CART_NOT_MET`, `MAX_REDEMPTIONS_REACHED` (UX guard on `usedCount` vs `maxRedemptions`), `ALREADY_USED` (user already has a `DiscountUsage` row for that discount).

**Stale cart discount (`GET /cart`):** if `Cart.discountId` is set but validation fails, the response includes `discountInvalidReason` and `discountInvalidCode`, totals are recomputed without the discount, and `Cart.discountId` is cleared in the same request.

## Stripe coupon mirroring

For `PERCENTAGE` and `FIXED`, admin create calls Stripe **first**, then inserts the local `Discount` with `stripeCouponId`. Coupon payload includes:

- `duration: 'once'`
- `name`: normalized code
- `metadata`: `{ code }` (local `discountId` is not known pre-insert; optional dashboard cleanup uses Stripe id)
- When set: `max_redemptions` mirroring `maxRedemptions`
- When set: `redeem_by` as Unix seconds from `validUntil`

Stripe does **not** model `validFrom`; the API remains canonical for the start window.

`FREE_SHIPPING` discounts do **not** create Stripe coupons; Checkout uses a zero `shipping_options` rate (display name “Free shipping”) below the free-shipping threshold.

## Webhook redemption

Inside the existing `PENDING → PAID` transaction (after guarded stock decrements, before status flips to `PAID`):

1. If `order.discountId` is set, `applyToOrder(discountId, orderId, tx)` runs.
2. Redemption uses an atomic `UPDATE "Discount" SET usedCount = usedCount + 1 WHERE …` with `maxRedemptions` enforcement comparable to the stock `updateMany` guard.
3. A `DiscountUsage` row is inserted; `@@unique([discountId, userId])` and `@@unique([discountId, orderId])` protect integrity.
4. If redemption returns `MAX_REDEMPTIONS_REACHED` or `ALREADY_USED`, or a unique violation occurs after increment, the order is marked `CANCELLED`, `[discount_redemption_incident]` is logged, and confirmation email is skipped—mirroring the oversold path.

Duplicate `checkout.session.completed` deliveries are idempotent: only the first `PENDING → PAID` transition records usage.

## Admin API

- `POST /admin/discounts` — create (auth + `ADMIN`). Body: `code`, `type`, `value`, optional `minCartCents`, `maxRedemptions`, `validFrom`, `validUntil`, `active`. Stripe coupon creation failure → `400` with `reason: STRIPE_COUPON_REJECTED` (no local row).
- `GET /admin/discounts` — paginated list; optional `active=true|false` query.

## Logging

Log discount **ids** and coarse reasons (e.g. validation rejected, redemption race). Do not log raw miss traffic suitable for code enumeration.

## Orphan Stripe coupons

If Stripe coupon creation succeeds but the local insert fails, logs include `[discount_orphan_stripe_coupon]` with the Stripe coupon id; delete the orphan in the Stripe Dashboard.

## Deferred (Phase 21)

Patch/disable/delete discounts, analytics, product-scoped rules, stacking, promotion codes, and general rate limiting middleware (unless added separately).
