// Load .env for local dev. In CI env vars are set directly in the job environment.
// dotenv never overrides an already-set variable, so this is safe in both contexts.
import 'dotenv/config';

// Set required env vars before any module loads (env.ts runs validateEnv at import time).
// Use || rather than ?? so that empty-string values in .env also fall through to test defaults.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/test';
// Fixed secrets/URLs for HS256 test tokens and Stripe test signatures — never use .env values
// here. SUPABASE_URL in particular must be forced (not just defaulted with ||): a developer's
// local .env commonly has a real Supabase project URL, and since dotenv/config() above already
// populates process.env.SUPABASE_URL from it before this line runs, a `||` fallback would never
// fire. verify-supabase-jwt.ts derives the expected JWT issuer from SUPABASE_URL and every test
// token minter hardcodes issuer 'https://test.supabase.co/auth/v1' to match — so this value must
// stay pinned to the test placeholder regardless of what's in .env (F7).
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
process.env.CRON_BEARER_TOKEN =
  process.env.CRON_BEARER_TOKEN || 'test-cron-bearer-token-min-32-chars-xxxx';
process.env.SHIPPING_TOKEN_SECRET =
  process.env.SHIPPING_TOKEN_SECRET || 'test-shipping-token-secret-32chars-xxxx';
process.env.RESEND_API_KEY ??= 'test-resend-key';
process.env.EMAIL_FROM ??= 'Pet Supplies <test@example.com>';
process.env.CANADA_POST_API_KEY ||= 'test-canada-post-api-key';
process.env.CANADA_POST_CUSTOMER_NUMBER ||= '0000000000';
process.env.SHIP_FROM_POSTAL_CODE ||= 'K1A0A1';
// Always run in test mode regardless of what .env specifies
process.env.NODE_ENV = 'test';
