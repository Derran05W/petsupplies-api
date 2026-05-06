# Testing

## Stack

- **Runner**: Vitest (Node environment)
- **HTTP**: `app.request` from `createApp()` (Hono), aligned with production routing
- **Coverage**: `@vitest/coverage-v8` with global thresholds (see `vitest.config.ts`)

## Commands

| Command | Purpose |
|--------|---------|
| `pnpm test` | Full suite **with coverage**; fails if thresholds are not met |
| `pnpm test:watch` | Watch mode **without** coverage (faster feedback) |
| `pnpm test:coverage` | Same as `pnpm test` today — full run with coverage |

## Environment

`tests/setup.ts` loads `.env` via `dotenv/config` first (for local dev), then sets safe fallback defaults for all other env vars (`SUPABASE_JWT_SECRET`, `STRIPE_*`, etc.) before files import `src/types/env.ts`. In CI, `DATABASE_URL` is injected by the job environment and `dotenv` won't override it.

**PostgreSQL** is required for the end-to-end test in `tests/e2e/happy-path.test.ts`. It uses the shared Prisma client (`src/lib/prisma.ts`) and expects a migrated schema (`pnpm exec prisma migrate deploy` or `pnpm db:migrate`). If no database is reachable at `DATABASE_URL`, that file fails fast (typically `ECONNREFUSED` / Prisma `P1001`).

Local workflow:

1. Add `DATABASE_URL=<your-postgres-url>` to `.env` (already present if you followed the setup guide).
2. `pnpm exec prisma migrate deploy`
3. `pnpm test`

CI (`.github/workflows/ci.yml`) provides a Postgres service, runs `prisma migrate deploy`, then `pnpm test`, so the E2E test runs there without extra flags.

## Layers

- **Unit tests** (`tests/unit/`): services, middleware, and route handlers with mocked Prisma or services.
- **Integration tests** (`tests/integration/`): routing, validation, and Stripe **signature verification** on `/webhooks/stripe`. Webhook integration tests mock `webhookService` handlers but keep real `stripe.webhooks.constructEvent` (see `tests/integration/webhooks.test.ts`).
- **E2E** (`tests/e2e/happy-path.test.ts`): one happy path — JWT auth, product browse, cart, checkout with a **spy** on `stripe.checkout.sessions.create`, signed `checkout.session.completed` webhook, then asserts `PAID`, totals, shipping snapshot, and stock decrement. Checkout is not fully mocked at the module level so webhook verification stays real.

## Stripe in tests

- **Never** replace `src/lib/stripe.js` with a full mock in suites that need `constructEvent`.
- Prefer `vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue(...)` for checkout, and `Stripe.webhooks.generateTestHeaderString` with the exact raw JSON string POSTed to `/webhooks/stripe`.

## Coverage artifacts

HTML and `lcov` reports are written under `coverage/`. That directory is gitignored; remove it anytime with `rm -rf coverage`.
