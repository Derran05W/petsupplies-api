# Scheduled cron jobs (Phase 17 + Phase 18)

## Overview

Hourly jobs (or your chosen cadence) run **outside** the Node process via an external scheduler (Railway Cron or GitHub Actions). Each job is triggered with an authenticated `POST`:

- **`abandoned-cart`** — finds carts idle for ≥24 hours, reminders throttled to once per cart per 7 days, emails customers with abandoned items.
- **`upcoming-delivery`** — finds active subscriptions whose **`nextDeliveryAt`** falls in a one-hour window **starting three days from “now”** (UTC), and sends the Subscribe & Save upcoming-delivery reminder.
- **`back-in-stock`** (Phase 18) — scans pending stock-alert rows (`notifiedAt` null) for products that are **active and in stock**, and sends **`back-in-stock-alert`** emails (same template as inline restock fanout). Inline sends also run when sellable stock crosses **`0 → >0`** (e.g. admin **`PAID → CANCELLED`** restock); the cron path is the **retry** surface for failed Resend deliveries without blocking stock mutations.

Operational behavior, auth, logging, and idempotency are documented below. Transactional templates and Resend usage are summarized in [`email.md`](./email.md).

## Architecture

Railway Cron (or GitHub Actions `schedule`) issues HTTP POSTs to the deployed API:

```text
Railway Cron service  (or GitHub Actions schedule, fallback)
        |  hourly (example)
        |  POST /jobs/run/abandoned-cart
        |  POST /jobs/run/upcoming-delivery
        |  POST /jobs/run/back-in-stock
        |  Authorization: Bearer ${CRON_BEARER_TOKEN}
        v
[ Hono API ]  src/routes/jobs.ts + cronAuth (timing-safe Bearer compare)
        v
src/services/jobRunner.ts
   |-- runAbandonedCartJob(now)
   |      --> cartService.findAbandonedCartCandidates
   |      --> emailService.sendAbandonedCartReminder
   |      --> Cart.lastAbandonedEmailAt stamp after successful send
   |
   |-- runUpcomingDeliveryJob(now)
   |      --> subscriptionService.sendUpcomingDeliveryRemindersDue
   |               (UTC window [now+3d, now+3d+1h) )
   |
   `-- runBackInStockNotificationJob(now)
          --> stockAlertService.dispatchBackInStockNotifications (per productId batch)
        v
JSON JobResult { scanned, sent, failed, skipped, durationMs }
```

## Setup (Railway Cron)

1. Generate a long random bearer (e.g. 32 random bytes as 64-character hex).
2. Set **`CRON_BEARER_TOKEN`** to that value on **both**:
   - the **main API** Railway service, and
   - the **cron caller** Railway service that runs scheduled commands.
3. Create a cron service that runs hourly (adjust if you deliberately change tempo).
4. Cron command examples (cron service env should include **`API_URL`** pointing at `https://<your-service>.up.railway.app`):

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" "$API_URL/jobs/run/abandoned-cart"

curl -fsS -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" "$API_URL/jobs/run/upcoming-delivery"

curl -fsS -X POST -H "Authorization: Bearer $CRON_BEARER_TOKEN" "$API_URL/jobs/run/back-in-stock"
```

5. Redeploy after env changes.

## Setup (GitHub Actions fallback)

If Railway Cron is not available on your plan, trigger the same HTTPS endpoints from a scheduled workflow stored in `.github/workflows/` (snippet only — adjust URL and secrets):

```yaml
name: hourly-cron-call
on:
  schedule:
    - cron: '0 * * * *'
jobs:
  call-api:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_BEARER_TOKEN }}" \
            "${{ secrets.API_URL }}/jobs/run/abandoned-cart"
          curl -fsS -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_BEARER_TOKEN }}" \
            "${{ secrets.API_URL }}/jobs/run/upcoming-delivery"
          curl -fsS -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_BEARER_TOKEN }}" \
            "${{ secrets.API_URL }}/jobs/run/back-in-stock"
```

Wire `secrets.CRON_BEARER_TOKEN` and `secrets.API_URL` per environment.

## Auth

`POST /jobs/run/:name` uses **`cronAuth`**: **`Authorization: Bearer <token>`** only (no `?token=` query params).

The bearer is compared with `crypto.timingSafeEqual`; buffers must match in length — otherwise the handler responds `401` without calling `timingSafeEqual` with mismatched lengths.

The bearer is **never** logged. Responses are `{ "error": "UNAUTHORIZED" }` without extra detail.

## Logging

All job-related logs **must remain id-only**:

- Allowed: **`userId`**, **`cartId`**, **`subscriptionId`**, **`productId`**, **`alertId`**, **`op`**, **`evt`** (machine event slug), **`scanned`**, **`sent`**, **`failed`**, **`skipped`** (and analogous counters), **`code`** when classifying failures.
- Do **not** log: email addresses, tokens, bearer values, rendered email bodies or subjects, recipient partials, product names in cart-item logging, raw Resend response bodies beyond success / message id correlation.

## Idempotency / throttle

| Job               | Postgres throttle                                                                                                                                                                                                                              | Resend key                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Abandoned cart    | `updatedAt` older than `now − 24h` and (`lastAbandonedEmailAt` absent or **`now − 7d`** stale); **`lastAbandonedEmailAt`** stamped only after `send` returns **`ok`**; stamp uses **`updateMany`** guarded on the prior `lastAbandonedEmailAt` | `abandoned-cart/{userId}/{cartId}/{yyyy-mm-dd}` (UTC day of the cron run instant)     |
| Upcoming delivery | none in DB — window + hourly slice                                                                                                                                                                                                             | `upcoming-delivery/{subscriptionId}/{yyyy-mm-dd}` (UTC day from **`nextDeliveryAt**`) |
| Back in stock     | **`StockAlert.notifiedAt`** set only after **`send`** returns **`ok`**; **`updateMany`** guard (`notifiedAt` still null); **`Product.stockAlertEpisode`** advances atomically inside the same `$transaction` as the decrement that lands `stock = 0` (CAS `where: { id, stock: 0 }`) so the bump is at-most-once per real sell-out even under concurrent paid checkouts. The episode also scopes Resend keys per cycle. Restock paths **read** the episode but never bump it. | `back-in-stock-alert/{userId}/{productId}/{stockAlertEpisode}` (see [`email.md`](./email.md)) |

Tunable knobs: abandonment delay (24h), reminder throttle (7d), and “three days before delivery” horizon are product-policy — update them here when you tune code.

### Verified-email assumption (abandoned cart)

Eligibility treats **`User.email IS NOT NULL` and `User.role === CUSTOMER`** as a **verified-email** surrogate: the **`sync_auth_user`** Supabase trigger (see [`supabase/triggers/sync_auth_user.sql`](../supabase/triggers/sync_auth_user.sql)) mirrors **confirmed** `auth.users` into `public."User"` for this project.

## How to add a new cron job

1. Add **`run…Job`** in `src/services/jobRunner.ts`; export the case in **`JobName`** (how it appears under `/jobs/run/:name`).
2. Register it in **`RUNNERS`** in `src/routes/jobs.ts`.
3. Extend **`tests/unit/jobRunner.test.ts`** for batch limits, skips, failures, stamping, windows.
4. Extend **`tests/integration/jobs.test.ts`** (`401`, `404`, `200`, `500`).
5. Add scheduler entries pointing at **`POST /jobs/run/<job-name>`** + Bearer auth.
6. Cross-link **`docs/email.md`** if new templates arrive.

## Local manual trigger

With a sufficiently long **`CRON_BEARER_TOKEN`** in `.env` (see `.env.example`):

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_BEARER_TOKEN" \
  http://localhost:3001/jobs/run/abandoned-cart
```

## Troubleshooting

| Problem | Typical cause                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| `401`   | Missing/malformed `Authorization` header, wrong token                                                             |
| `404`   | Job name typo — valid names: **`abandoned-cart`**, **`upcoming-delivery`**, **`back-in-stock`** |
| `500`   | Unhandled runner throw — structured log **`evt=job_unhandled_error`** carries **`name`**, not exceptions          |

## Timezone

All comparisons and **`yyyy-mm-dd`** idempotency fragments use **UTC**.
