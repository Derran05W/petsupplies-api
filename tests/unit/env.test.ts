import { describe, it, expect } from 'vitest';
import { validateEnv } from '../../src/types/env.js';

const VALID: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://localhost/test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_JWT_SECRET: 'supersecretkey',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  STRIPE_SECRET_KEY: 'sk_test_key',
  STRIPE_WEBHOOK_SECRET: 'whsec_key',
  FRONTEND_URL: 'http://localhost:3000',
};

describe('validateEnv', () => {
  it('accepts a complete valid env', () => {
    const result = validateEnv(VALID);
    expect(result.PORT).toBe(3001);
    expect(result.NODE_ENV).toBe('development');
  });

  it('throws when DATABASE_URL is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { DATABASE_URL: _db, ...rest } = VALID;
    expect(() => validateEnv(rest as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('throws when SUPABASE_URL is not a valid URL', () => {
    expect(() => validateEnv({ ...VALID, SUPABASE_URL: 'not-a-url' })).toThrow(/SUPABASE_URL/);
  });

  it('throws when FRONTEND_URL is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { FRONTEND_URL: _fe, ...rest } = VALID;
    expect(() => validateEnv(rest as NodeJS.ProcessEnv)).toThrow(/FRONTEND_URL/);
  });

  it('coerces PORT from string to number', () => {
    const result = validateEnv({ ...VALID, PORT: '4000' });
    expect(result.PORT).toBe(4000);
  });
});
