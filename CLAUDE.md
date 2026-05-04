# petsupplies-api

REST API backend for a pet supplies e-commerce platform.

## Stack

- **Runtime**: Node.js 20 LTS, TypeScript strict mode
- **Framework**: Hono
- **ORM**: Prisma 7 (with `@prisma/adapter-pg`)
- **Database**: PostgreSQL — Supabase (prod), Railway Postgres (dev)
- **Auth**: Supabase JWT verification
- **Payments**: Stripe
- **Validation**: Zod
- **Tests**: Vitest + Supertest + `@hono/testing`

## Commands

| Command           | Purpose                          |
| ----------------- | -------------------------------- |
| `pnpm dev`        | Start dev server with watch mode |
| `pnpm build`      | TypeScript build to `dist/`      |
| `pnpm test`       | Run all tests                    |
| `pnpm lint`       | ESLint check                     |
| `pnpm type-check` | TypeScript no-emit check         |
| `pnpm db:migrate` | `prisma migrate dev`             |
| `pnpm db:seed`    | Seed database                    |
| `pnpm db:studio`  | Prisma Studio UI                 |

## Before committing

**Always run:** `pnpm type-check && pnpm lint && pnpm test`
The Husky pre-commit hook runs `lint-staged`; commit-msg runs `commitlint`.

## Where things live

- `src/routes/` — Hono route handlers (thin)
- `src/services/` — business logic (thick, testable)
- `src/middleware/` — auth, errorHandler, requestLogger, adminOnly
- `src/lib/` — singleton clients (prisma, stripe, supabase)
- `src/types/` — env validation, Hono context types
- `prisma/` — schema, migrations, seed
- `prisma.config.ts` — Prisma 7 config (replaces `datasource.url` in schema)
- `supabase/triggers/` — SQL triggers applied **manually** in Supabase SQL editor (NOT Prisma migrations)
- `tests/unit/` — service-level tests (mocked DB)
- `tests/integration/` — route-level tests (real or pg-mem DB)
- `.planning/` — phase plans + design docs (**GITIGNORED**, never push to public repo)

## Critical patterns

### Prisma 7 (different from Prisma 6)

- Connection URL lives in `prisma.config.ts`, **NOT** in `schema.prisma` datasource block
- Use `PrismaPg` from `@prisma/adapter-pg` (the export is **NOT** named `PrismaPostgres`)
- The PrismaClient must be constructed with an adapter:

  ```ts
  import { PrismaClient } from '@prisma/client';
  import { PrismaPg } from '@prisma/adapter-pg';
  import { Pool } from 'pg';

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  ```

- Same pattern is required in `prisma/seed.ts` and `prisma.config.ts`

### Auth

- Auth middleware **only** verifies the Supabase JWT and attaches `userId` to the Hono context
- It does **NOT** upsert User rows — that's handled by a Supabase database trigger (`supabase/triggers/sync_auth_user.sql`)
- `adminOnly` middleware checks `User.role === ADMIN` (loads from DB) after `auth`
- Admin promotion is done via a one-off SQL `UPDATE` in Supabase, not via API

### Stock management

- Stock is **never** touched at session creation — only validated
- Stock decrement happens **only** in the webhook on `PENDING → PAID` transition
- Stock restore happens on admin `PAID → CANCELLED` transition
- All decrements use `prisma.product.updateMany({ where: { stock: { gte: quantity } } })` to guard against oversell — if `count: 0` in any update, abort transaction and mark order CANCELLED
- Decrement + status change always run inside a single `prisma.$transaction`

### Order flow (Stripe-recommended)

- Order created at Stripe session creation with status `PENDING`
- Cart is cleared in the same Prisma transaction as order creation
- Webhook idempotently flips `PENDING → PAID` (check current status before mutating)
- All money values stored in **cents** (`Int`), never floats

### Cart

- Server-side cart, one Cart per User (`@@unique` on `userId`)
- `POST /cart/items` is an upsert that accumulates quantity (uses `@@unique([cartId, productId])`)
- Stock validated at every cart mutation, but stock not decremented until PAID

### Webhooks

- `POST /webhooks/stripe` MUST be registered before any JSON body parser middleware — Stripe needs the raw body for signature verification
- Idempotency: check current order status before mutating; ack 200 if already in target state

## Plans

- Master plan: `.planning/plan.md` (24 phases mapped out)
- Phase tracker: `.planning/phases.md`
- Pre-phase checklists: `.planning/pre-phase3-changes.md`
- The `.planning/` folder is gitignored — never push to public repo
- **Detail-plan only the next 1-2 phases at a time** — long-range plans decay

## Model usage

| Task | Model | Effort |
|---|---|---|
| Architectural decisions, phase planning, complex debugging | Opus 4.7 | high |
| Implementing features, writing tests, following an established plan | Sonnet 4.6 | medium |
| Mechanical tasks (rename, reformat, boilerplate) | Sonnet 4.6 | low |

Default: **Sonnet 4.6, medium effort**. Switch to Opus only when the task requires deep reasoning — if the plan is already written and the scope is clear, stay on Sonnet.

## Workflow

1. **One phase per session** — start fresh, end with all gates green
2. **Plan with Opus 4.7 (high effort), implement with Sonnet 4.6 (medium effort)** — use `/model` to switch
3. **Phase loop:** plan → implement → verify (test/lint/type-check) → commit → update tracker
4. **Verification gates between phases:** all tests pass, lint clean, type-check clean, code committed, phase tracker updated, migration runs cleanly on fresh DB if schema changed

## Key decisions (rationale in `.planning/plan.md`)

1. **Server-side cart** (not client-side) — supports cross-device persistence and future abandoned-cart emails
2. **Supabase DB trigger** handles user sync (auth middleware doesn't upsert)
3. **Auth required for checkout** (no guest checkout for MVP)
4. **PENDING at session creation, PAID via webhook** — Stripe-recommended pattern
5. **Stock decrement on PAID only** — prevents ghost holds from abandoned carts
6. **Manual fulfillment** via `PATCH /admin/orders/:id/status` (no shipping integration in MVP)

## Repo

- Public GitHub: `git@github.com:Derran05W/petsupplies-api.git`
- Will eventually be open source — keep secrets out of `.env.example`, all design docs in `.planning/` (gitignored)

## Hosting

- Railway (staging + prod services). Each service has its own Supabase project + Stripe webhook.
- DBs auto-migrate on container boot (`prisma migrate deploy && node dist/index.js`).
