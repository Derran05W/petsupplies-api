# MVP launch checklist

Blockers and operational steps that are **not** fully automated in this repository.

## Before first production traffic

1. **Database**: Apply all Prisma migrations (`pnpm exec prisma migrate deploy`) on the production Postgres instance.
2. **Supabase**: Run the auth → `User` sync trigger from `supabase/triggers/` in the Supabase SQL editor (see deployment runbook).
3. **Admin users**: Promote at least one user to `ADMIN` with a one-off SQL update in Supabase; there is no public promotion API.
4. **Stripe**: Create products/prices as needed; register the production webhook URL for `/webhooks/stripe` with the signing secret in env; verify idempotency in staging first.
5. **Environment**: Set `DATABASE_URL`, `SUPABASE_*`, `STRIPE_*`, `FRONTEND_URL`, `PORT`, and shipping-related cents vars per `.env.example`. `DIRECT_URL` is not used by this API (Prisma 7 uses `DATABASE_URL` in `prisma.config.ts` only).
6. **Smoke test**: Health check (`GET /health`), anon product list, authenticated cart round-trip, and a small test order in Stripe test mode before switching live keys.

## Quality gates before tagging a release

Run the same gates as CI (and Husky pre-commit where applicable):

- `pnpm type-check`
- `pnpm lint`
- `pnpm test` (includes coverage thresholds)
- `pnpm build`

## Support references

- Deployment and hosting: `docs/deployment.md`
- How tests are organized: `docs/testing.md`
