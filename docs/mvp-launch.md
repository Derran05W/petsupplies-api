# MVP launch checklist

Blockers and operational steps that are **not** fully automated in this repository.

## Before first production traffic

1. **Database**: Apply all Prisma migrations (`pnpm exec prisma migrate deploy`) on the production Postgres instance.
2. **Supabase**: Run the auth → `User` sync trigger from `supabase/triggers/` in the Supabase SQL editor (see deployment runbook).
3. **Admin users**: Promote at least one user to `ADMIN` with a one-off SQL update in Supabase; there is no public promotion API.
4. **Stripe**: Create products/prices as needed; register the production webhook URL for `/webhooks/stripe` with the signing secret in env; verify idempotency in staging first.
5. **Environment**: Set `DATABASE_URL`, `SUPABASE_*`, `STRIPE_*`, `FRONTEND_URL`, `PORT`, `RESEND_API_KEY`, `EMAIL_FROM`, and shipping-related cents vars per `.env.example`. `DIRECT_URL` is not used by this API (Prisma 7 uses `DATABASE_URL` in `prisma.config.ts` only).
6. **Resend**: Set `RESEND_API_KEY` and `EMAIL_FROM` per Railway service; verify the sender domain in the Resend dashboard; redeploy; confirm transactional mail on staging checkout + admin shipped transition (details in [`docs/email.md`](./email.md)).
7. **Smoke test**: Health check (`GET /health`), anon product list, authenticated cart round-trip, and a small test order in Stripe test mode before switching live keys. **Discounts (Phase 12):** create a staging percentage code via `POST /admin/discounts`, apply with `POST /cart/discount`, complete checkout, verify the mirrored Stripe coupon and populated order snapshot fields, confirm webhook PAID creates exactly one `DiscountUsage`, then resend `checkout.session.completed` once and verify redemption stays idempotent (see [`docs/discounts.md`](./discounts.md)).

## Quality gates before tagging a release

Run the same gates as CI (and Husky pre-commit where applicable):

- `pnpm type-check`
- `pnpm lint`
- `pnpm test` (includes coverage thresholds)
- `pnpm build`

## Support references

- Deployment, hosting, and email: `docs/deployment.md`, `docs/email.md`
- How tests are organized: `docs/testing.md`
