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

  it('defaults EMAIL_FROM in development and test when unset', () => {
    expect(
      validateEnv({
        ...VALID,
        NODE_ENV: 'development',
      } as NodeJS.ProcessEnv).EMAIL_FROM,
    ).toBe('Pet Supplies <dev@localhost>');

    expect(
      validateEnv({
        ...VALID,
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv).EMAIL_FROM,
    ).toBe('Pet Supplies <dev@localhost>');
  });

  it('allows missing RESEND_API_KEY in development', () => {
    expect(() =>
      validateEnv({
        ...VALID,
        NODE_ENV: 'development',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('allows missing RESEND_API_KEY in test', () => {
    expect(() =>
      validateEnv({
        ...VALID,
        NODE_ENV: 'test',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('requires RESEND_API_KEY and EMAIL_FROM in production', () => {
    expect(() =>
      validateEnv({
        ...VALID,
        NODE_ENV: 'production',
        EMAIL_FROM: 'Pet <o@x.com>',
      } as NodeJS.ProcessEnv),
    ).toThrow(/RESEND_API_KEY/);

    expect(() =>
      validateEnv({
        ...VALID,
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_xxx',
      } as NodeJS.ProcessEnv),
    ).toThrow(/EMAIL_FROM/);

    expect(
      validateEnv({
        ...VALID,
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_xxx',
        EMAIL_FROM: 'Pet <o@x.com>',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ NODE_ENV: 'production' });
  });

  it('throws in production when RESEND_API_KEY is blank', () => {
    expect(() =>
      validateEnv({
        ...VALID,
        NODE_ENV: 'production',
        RESEND_API_KEY: '   ',
        EMAIL_FROM: 'Pet Supplies <orders@example.com>',
      } as NodeJS.ProcessEnv),
    ).toThrow(/RESEND_API_KEY/);
  });

  it('throws in production when EMAIL_FROM is blank', () => {
    expect(() =>
      validateEnv({
        ...VALID,
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test_key',
        EMAIL_FROM: '',
      } as NodeJS.ProcessEnv),
    ).toThrow(/EMAIL_FROM/);
  });

  it('rejects empty EMAIL_FROM when the variable is set but whitespace-only', () => {
    expect(() =>
      validateEnv({
        ...VALID,
        EMAIL_FROM: ' \t ',
      } as NodeJS.ProcessEnv),
    ).toThrow(/EMAIL_FROM cannot be empty when set/);
  });

  it('coerces PORT from string to number', () => {
    const result = validateEnv({ ...VALID, PORT: '4000' });
    expect(result.PORT).toBe(4000);
  });
});
