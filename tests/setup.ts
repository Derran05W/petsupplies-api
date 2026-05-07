// Load .env for local dev. In CI env vars are set directly in the job environment.
// dotenv never overrides an already-set variable, so this is safe in both contexts.
import 'dotenv/config';

// Set required env vars before any module loads (env.ts runs validateEnv at import time).
// Use || rather than ?? so that empty-string values in .env also fall through to test defaults.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET || 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_key';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
process.env.RESEND_API_KEY ??= 'test-resend-key';
process.env.EMAIL_FROM ??= 'Pet Supplies <test@example.com>';
// Always run in test mode regardless of what .env specifies
process.env.NODE_ENV = 'test';
