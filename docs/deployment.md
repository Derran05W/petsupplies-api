# Deployment

Operational runbook for deploying `petsupplies-api` to Railway. This document covers what humans must do once per environment; CI takes care of everything else.

> Secrets in this file are referenced **by name only**. Real values live in Railway service env vars and the Supabase / Stripe dashboards. Do not commit `.env` to the repo.

---

## Architecture overview

| Environment | Branch    | Railway service           | Supabase project         | Stripe account       |
| ----------- | --------- | ------------------------- | ------------------------ | -------------------- |
| Staging     | `staging` | `petsupplies-api-staging` | staging Supabase project | Stripe **test** mode |
| Production  | `main`    | `petsupplies-api-prod`    | prod Supabase project    | Stripe **live** mode |

Railway watches each branch via its GitHub integration, builds the image from the repo-root `Dockerfile`, and rolls out a new deployment on every successful push. There are no deploy jobs in GitHub Actions — Railway owns the deploy path. CI's job is to fail before a bad commit ever reaches a watched branch.

The container's `CMD` runs `pnpm exec prisma migrate deploy` before starting the server, so database migrations are applied automatically on every boot.

---

## Branch → environment mapping

- `staging` → `petsupplies-api-staging` (Stripe test, staging Supabase, staging Frontend URL)
- `main` → `petsupplies-api-prod` (Stripe live, prod Supabase, prod Frontend URL)

No PR preview environments in the MVP.

---

## First-time Railway setup (per service)

Repeat once for staging, once for prod.

1. Create a new Railway project (or service inside an existing project).
2. **Connect GitHub repo**: `Derran05W/petsupplies-api`. Set the watched branch (`staging` for the staging service, `main` for the prod service).
3. **Builder**: Railway auto-detects the repo-root `Dockerfile`. No manual config needed.
4. **Healthcheck**: path `/health`, timeout `30s`.
5. **Restart policy**: `ON_FAILURE` (Railway default).
6. **Replicas**: 1 (Railway default).
7. **Service domain**: use the Railway-provided `*.up.railway.app` domain to start. Custom domains are out of scope for Phase 9.
8. **Configure env vars** per the checklist below.
9. **Trigger first deploy** (push or manual deploy from the Railway dashboard).

---

## Per-service env vars

All values are environment-specific. Set every variable below in each Railway service's env-vars panel.

### Database

- `DATABASE_URL` — Supabase pooled connection string for that environment's Supabase project.

### Supabase

- `SUPABASE_URL` — `https://<project-ref>.supabase.co`
- `SUPABASE_JWT_SECRET` — HS256 secret used to verify JWTs in middleware (Supabase project → Settings → API → JWT Secret).
- `SUPABASE_SERVICE_ROLE_KEY` — admin key. **Never** expose to the frontend.

### Stripe

- `STRIPE_SECRET_KEY` — `sk_test_...` for staging, `sk_live_...` for prod.
- `STRIPE_WEBHOOK_SECRET` — copied from the Stripe webhook endpoint you create below.

### App

- `NODE_ENV` — `production` for both Railway services.
- `PORT` — Railway sets this automatically; do not hardcode.
- `FRONTEND_URL` — used for CORS and Stripe success/cancel URLs. Distinct per env.
- `CRON_BEARER_TOKEN` — long shared secret (**≥32 chars** recommended: 64 hex chars from 32 random bytes). Authenticates **`POST /jobs/run/:name`**. Same value must be configured on **both** the API service **and** the Railway Cron runner that calls those URLs.

### Resend / transactional email

Transactional email uses Resend (`resend`). Set these **per Railway service** (staging and prod each need their own key and verified sender).

1. Create an API key in the Resend dashboard for that environment (staging vs prod may use separate Resend workspaces or keys).
2. **Verify** the sending domain (or onboarding domain) for the sender you will use — unverified senders typically fail with HTTP 403 from the provider.
3. Set `RESEND_API_KEY` and `EMAIL_FROM` in the Railway service env vars (`EMAIL_FROM` is usually `Friendly Name <orders@your-verified-domain>`).
4. **Redeploy** the service after changing env vars so the process picks them up.
5. Smoke test: complete a staging checkout and confirm **order confirmation** email; mark an order **PAID → SHIPPED** in admin and confirm **shipping** email (body shows raw carrier + tracking number only; no carrier tracking URL map in Phase 11). See [`docs/email.md`](./email.md) for idempotency, logging, and troubleshooting (`401`, `403`, `429`).

### Shipping (optional — has defaults in `src/types/env.ts`)

- `FREE_SHIPPING_THRESHOLD_CENTS` — default `5000` (cents).
- `FLAT_SHIPPING_CENTS` — default `599` (cents).

### Canada Post (Phase 24 — live rates + fallback)

Phase 24 adds **Canada Post** rating alongside existing flat / free-shipping thresholds. **Checkout remains usable** when credentials are missing or the carrier API fails: the API falls back to `FLAT_SHIPPING_CENTS` / threshold behavior.

**Env vars** (all optional; omit any of the first three to force fallback-only):

| Variable                                                                 | Purpose                                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `CANADA_POST_API_KEY`                                                    | Developer / production API key (password for Basic auth).                                             |
| `CANADA_POST_CUSTOMER_NUMBER`                                            | Canada Post customer number.                                                                          |
| `CANADA_POST_USERNAME`                                                   | Basic auth username when it differs from customer number (defaults to `CANADA_POST_CUSTOMER_NUMBER`). |
| `CANADA_POST_CONTRACT_ID`                                                | Optional contract id for negotiated rates.                                                            |
| `CANADA_POST_USE_TEST`                                                   | If `true` (default), uses Canada Post CT endpoint; set `false` for production SOA host.               |
| `SHIP_FROM_POSTAL_CODE`                                                  | Warehouse origin (Canadian postal, validated when set).                                               |
| `SHIPPING_QUOTE_TIMEOUT_MS`                                              | HTTP timeout for rating calls (default `4000`).                                                       |
| `DEFAULT_PACKAGE_WEIGHT_GRAMS`                                           | Fallback per-line weight when `Product.weightGrams` is null (default `500`).                          |
| `DEFAULT_PACKAGE_L_CM` / `DEFAULT_PACKAGE_W_CM` / `DEFAULT_PACKAGE_H_CM` | Fallback dimensions in cm (defaults `25` / `20` / `10`).                                              |

See [`docs/shipping.md`](./shipping.md) for API flow and admin package metadata.

Operational checklist (staging, then prod):

1. Separate developer credentials per environment where possible.
2. Set `SHIP_FROM_POSTAL_CODE` to a valid ship-from for the account.
3. **Smoke:** quote with real keys; then **unset** `CANADA_POST_API_KEY` and confirm checkout still completes with flat rate.

Webhook / Stripe event list is unchanged for Phase 24.

---

## Mandatory: apply Supabase trigger before first traffic

Authentication is owned by Supabase Auth. A Postgres trigger mirrors new `auth.users` rows into `public."User"`. The API does **not** upsert users; if the trigger is missing, every JWT will pass middleware but the first DB write that joins to `User` will fail.

For each Supabase project (staging, then prod):

1. Open the Supabase SQL editor.
2. Paste the contents of [`supabase/triggers/sync_auth_user.sql`](../supabase/triggers/sync_auth_user.sql).
3. Run.
4. Verify: sign up a test user via Supabase Auth (dashboard → Authentication → Users → Invite or via the frontend) and confirm a row appears in `public."User"`.

---

## Promote an admin (per env)

There is no admin-promotion API. Run this in each env's Supabase SQL editor against the email of the user you want to promote:

```sql
UPDATE public."User"
   SET role = 'ADMIN'
 WHERE email = 'your@email.com';
```

The user must have signed up via Supabase Auth first (the trigger above creates the row).

---

## Register Stripe webhook endpoint (per env)

Stripe webhooks must be registered in the Stripe dashboard for each environment, pointing at that env's Railway service domain.

1. Stripe dashboard → Developers → Webhooks → **Add endpoint**.
2. **Endpoint URL**: `https://<railway-service-domain>/webhooks/stripe`.
3. **Events to send** (minimum):
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Save. Copy the **Signing secret** (starts with `whsec_`).
5. Set `STRIPE_WEBHOOK_SECRET` to that value in the matching Railway service.
6. Redeploy the Railway service so the new env var takes effect.

Use the **test** Stripe account for the staging endpoint and the **live** Stripe account for the prod endpoint. The two accounts have separate webhook lists and separate signing secrets.

---

## Phase 12 — Discount coupons in Stripe (staging smoke)

After each deploy that includes Phase 12 migrations:

1. Confirm the Railway service `STRIPE_SECRET_KEY` can create **Coupons** (Dashboard → Products → Coupons, or API).
2. As an admin JWT, `POST /admin/discounts` with a `PERCENTAGE` or `FIXED` payload; verify a matching **Coupon** appears in the Stripe test dashboard (`max_redemptions` / `redeem_by` should mirror optional fields).
3. Create a `FREE_SHIPPING` discount via the same endpoint; confirm **no** Stripe coupon exists for it (shipping is handled via Checkout `shipping_options` only).
4. Run a staging checkout with a percentage/fixed code; confirm Checkout shows the coupon and totals align with the API snapshot (`subtotalCents`, `discountCents`, `shippingCents` on `Order`).
5. Run a staging checkout with free shipping below `FREE_SHIPPING_THRESHOLD_CENTS`; confirm the shipping line is **Free shipping** (`amount: 0`).
6. Replay a signed `checkout.session.completed` in Stripe CLI or the dashboard "Resend"; confirm no duplicate `DiscountUsage` row and `Discount.usedCount` does not double-increment.

See [`docs/discounts.md`](./discounts.md) for validation rules, orphan-coupon cleanup, and redemption semantics.

---

## Phase 16 — Subscribe & Save (staging smoke)

1. Confirm **Billing / Subscriptions** is usable for the Stripe account (test mode for staging).
2. Dashboard → **Billing** → **Subscriptions** / **Customer emails**: configure **dunning** / Smart Retries (defaults are fine); payment-failure customer emails may remain Stripe-hosted for MVP.
3. Ensure the webhook endpoint lists **all** events in [Register Stripe webhook endpoint](#register-stripe-webhook-endpoint-per-env), including subscription and invoice events.
4. As **admin**, `PATCH /admin/products/:id/subscription` with `{ subscriptionEligible: true }`; verify **four** recurring Prices exist in Stripe for that product and matching `ProductSubscriptionPrice` rows locally.
5. Complete a **subscription Checkout** as a test customer; confirm `checkout.session.completed` / `customer.subscription.*` webhooks create/update **`Subscription`** rows.
6. After a paid renewal (or test **`invoice.paid`** replay), confirm **one** `Order` per invoice id, stock decrement, and **no duplicate** order when the same `invoice.paid` is replayed.
7. Shared coupon **`subscribe-save-5pct`** is created idempotently by app code on first Subscribe & Save Checkout — optional Dashboard verification under **Coupons**.

Operational detail: [`docs/subscriptions.md`](./subscriptions.md).

---

## Phase 17 — Cron service setup

1. Set **`CRON_BEARER_TOKEN`** identically on the **API Railway service** and on a dedicated **cron / worker** Railway service used only for outbound `curl`.
2. On the cron service configure one **hourly** command (timezone UTC unless localized):

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" "$API_URL/jobs/run/abandoned-cart"
curl -fsS -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" "$API_URL/jobs/run/upcoming-delivery"
curl -fsS -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" "$API_URL/jobs/run/back-in-stock"
```

`API_URL` is the HTTPS origin you already use (`https://*.up.railway.app`), without a trailing slash.

3. GitHub Actions **schedule** fallback mirrors the hourly pattern if Railway Cron cannot run on-plan — reuse the YAML in [`cron.md`](./cron.md).

4. **Verification (staging)** — bearer-only smoke:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" \
  "$API_URL/jobs/run/abandoned-cart" | jq .

curl -fsS -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" \
  "$API_URL/jobs/run/upcoming-delivery" | jq .

curl -fsS -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" \
  "$API_URL/jobs/run/back-in-stock" | jq .
```

Expect HTTP `200` and `JobResult` JSON (`scanned`, `sent`, `failed`, `skipped`, `durationMs`). Inspect logs remain id-only (`userId`, `cartId`, `subscriptionId`, no tokens / bodies).

---

## Phase 24 — Canada Post (staging smoke)

After Phase 24 merges:

1. Set Canada Post env vars on **staging** (see the **Canada Post** subsection under [Per-service env vars](#per-service-env-vars)).
2. Ensure at least one product has **`weightGrams`** (or equivalent) populated; confirm another product **without** weight still allows checkout via **fallback** pricing.
3. `POST /shipping/quote` with a valid saved `addressId` or inline CA address; assert returned options include **amountCents** and **selectionToken**.
4. `POST /checkout/session` with `shippingSelection` (token + `serviceCode` + `amountCents` + same address binding); confirm Stripe Checkout shows one shipping option matching the selection.
5. Simulate provider outage (wrong key or firewall) and confirm checkout still succeeds with **flat / free** shipping and logs contain **no** raw PII dumps.

---

## Pre-deploy verification (per env)

Before pointing public traffic at the service:

- [ ] `GET https://<service-domain>/health` returns `{"status":"ok"}`.
- [ ] `GET https://<service-domain>/products` returns the seeded product list (or an empty paginated payload if seeding hasn't run).
- [ ] Sign in via the frontend → add to cart → start a Stripe Checkout session. Confirm a `PENDING` order is created and the Stripe URL works.
- [ ] Complete the test checkout. Confirm the Stripe dashboard shows the webhook delivered with `200`, the `Order` flips to `PAID`, and product stock decremented.
- [ ] If staging-equivalent behavior is observed, repeat for prod.

---

## Local Docker validation

Useful for verifying Dockerfile changes before pushing.

```bash
# Build the image
docker build -t petsupplies-api:local .

# Run with your local .env (must include DATABASE_URL pointing at a reachable Postgres)
docker run --rm -p 3001:3001 --env-file .env petsupplies-api:local

# In another terminal
curl http://localhost:3001/health
```

Image size sanity check:

```bash
docker images petsupplies-api:local --format '{{.Size}}'
```

Target: ≤ 500MB. We can revisit a `pnpm deploy --prod` prune stage if we drift higher.

---

## Repo-level setup (one-time, after Phase 9 merges)

1. **Create the `staging` branch** from `main` so the Railway staging service has something to track:
   ```bash
   git checkout main
   git pull
   git checkout -b staging
   git push -u origin staging
   ```
2. **Branch protection** in GitHub → Settings → Branches:
   - `main`: require status checks `Quality`, `Test + Build`, `Docker Build`. Require PR review. Require linear history.
   - `staging`: same status checks. PR review optional.

---

## Phase 26 — Admin Product Management: Supabase Storage setup

One-time step per environment before admin product image uploads will work:

1. Open the Supabase dashboard for the environment.
2. Go to **Storage → Buckets → New bucket**.
3. Name it `product-images` (or the value of `SUPABASE_STORAGE_BUCKET`).
4. Enable **Public bucket** (product images are publicly readable by the storefront).
5. Leave the default RLS policy in place (write is restricted to service role).

Set the env vars in Railway:

| Variable                           | Value            |
| ---------------------------------- | ---------------- |
| `SUPABASE_STORAGE_BUCKET`          | `product-images` |
| `SUPABASE_PRODUCT_IMAGE_MAX_BYTES` | `5000000`        |

See [`docs/admin-products.md`](./admin-products.md) for the full endpoint reference and image upload flow.

---

## Operational notes

- **Phase 21 extended admin dashboard** (`GET /admin/analytics/*`, `GET/PATCH`-style fulfillment helpers): **no new env vars** vs Phase 17. Inventory and caveats live in [`docs/admin-dashboard.md`](./admin-dashboard.md).
- **Migrations** run on every container boot via the `CMD`. For backwards-incompatible schema changes, split into expand → migrate → contract phases so a rolling restart keeps both old and new container generations alive.
- **Manual refunds**: paid admin cancellations log `[admin_cancel_paid_incident]` with the Stripe payment intent. The API does **not** call Stripe Refunds; issue refunds manually in the Stripe dashboard for MVP (Phase 8 decision).
- **Rolling back**: Railway dashboard → service → Deployments → choose a previous successful build → **Redeploy**. The container will re-apply migrations on boot, so rolling back is safe only if the migration history is also compatible.
- **Audit failures**: CI runs `pnpm audit --audit-level high`. A new high-severity advisory can red-CI overnight. If this blocks a hotfix, downgrade the threshold temporarily; do not bypass the audit gate by removing the step.

---

## What's intentionally out of scope for Phase 9

- PR preview environments (would require throwaway Supabase projects + Stripe test webhooks per PR).
- Sentry / observability instrumentation.
- Rate limiting on `/admin/*`.
- Image-size optimization via `pnpm deploy --prod` pruning (current image is ~350-450MB; acceptable).
- Custom domains.
- Coverage threshold (Phase 10 owns it).
