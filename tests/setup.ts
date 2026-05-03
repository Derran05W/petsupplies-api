// Set required env vars before any module loads (env.ts runs validateEnv at import time)
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://test.supabase.co';
process.env.SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_key';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
