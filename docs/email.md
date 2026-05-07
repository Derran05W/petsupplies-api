# Transactional email (Resend)

## Why Resend

The API uses [Resend](https://resend.com) for transactional mail: TypeScript-first Node SDK, a single `emails.send` call with `from`, `to`, `subject`, `html`, `text`, tags, and [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) (duplicate protection for the same key within a 24-hour window). Production requires a verified sending domain (or verified single sender) in the Resend dashboard.

## Environment variables

| Variable           | Purpose                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `RESEND_API_KEY`   | Resend API key (`re_...`). Required in **production**; optional in `development` / `test`. |
| `EMAIL_FROM`       | Sender address, e.g. `Pet Supplies <orders@your-domain.com>`. Required in **production**; in dev/test, must be non-empty if set. |

Real values are set per Railway service (staging vs production). Use separate keys and senders per environment if you want to isolate reputation and debugging.

## Local and test behavior

- **`NODE_ENV=test`**: Email transport is always a no-op. No HTTP calls to Resend. The client logs a single debug line with **template name** and **correlation id** (order id, cart id, etc.) only.
- **`NODE_ENV=development`** with missing or blank `RESEND_API_KEY`: Same no-op behavior so local checkout and webhooks work without configuring Resend.
- **`NODE_ENV=development`** with a non-empty key: Sends go through Resend (subject to your key and verified domain rules).

`tests/setup.ts` sets defaults for `RESEND_API_KEY` and `EMAIL_FROM` so Vitest validates env and integration tests behave consistently. **`NODE_ENV=test` still forces the no-op transport** regardless of `RESEND_API_KEY`.

## Idempotency keys

Stable keys per lifecycle (not secrets):

| Template                  | Key pattern                                      |
| ------------------------- | ------------------------------------------------ |
| Order confirmation        | `order-confirmation/{orderId}`                   |
| Shipping notification     | `shipping-notification/{orderId}`              |
| Delivery confirmation     | `delivery-confirmation/{orderId}` (API/template only until `DELIVERED` status exists) |
| Back in stock             | `back-in-stock-alert/{productId}`                |
| Abandoned cart reminder   | `abandoned-cart-reminder/{cartId}`              |
| Password reset            | `password-reset/{userId}`                        |

Order confirmation is sent only after a successful **`PENDING` → `PAID`** database transition, so Stripe webhook retries do not re-send; the idempotency key is an extra guard.

## Logging policy

**Log:** template name, internal ids (order id, cart id, product id, user id as correlation only), provider message id when present, and coarse outcome / error message from the provider.

**Do not log:** email HTML or plain-text bodies, full recipient addresses, API keys, Stripe webhook signatures, JWTs, password-reset URLs or tokens, shipping street addresses, or payment identifiers (beyond what existing incident logs already record per OWASP logging guidance).

## Troubleshooting (HTTP / API errors)

Symptoms map loosely to Resend responses; check the dashboard and response body.

| Symptom / code | Likely cause                                      |
| -------------- | ------------------------------------------------- |
| `401`          | Invalid or revoked API key.                       |
| `403`          | Unverified sender domain or `from` not allowed.   |
| `429`          | Rate limit; backoff and retry later if you add a queue in a future phase. |

## Deferred lifecycle (templates exist; hooks later)

- **Delivery confirmation** — waits on an order `DELIVERED` (or equivalent) status.
- **Abandoned cart reminder** — scheduled/lifecycle in a later phase.
- **Back in stock alert** — restock/alert flows in a later phase.
- **Password reset** — `sendPasswordReset` is a **stub** (returns `{ ok: true, skipped: true }`); Supabase Auth owns default reset mail unless you replace that flow later. `renderPasswordReset` remains for future use / template tests.
