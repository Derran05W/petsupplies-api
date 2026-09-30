import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';

// The asymmetric (JWKS) path calls `createRemoteJWKSet(url)` to get a key resolver that
// normally fetches over the network. Mock it to a controllable resolver so we can exercise
// the algorithm allowlist without a real Supabase JWKS endpoint.
const mJwks = vi.hoisted(() => ({
  getKey: vi.fn(),
}));

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: () => mJwks.getKey,
  };
});

import { verifySupabaseAccessToken } from '../../src/lib/verify-supabase-jwt.js';

describe('verifySupabaseAccessToken — asymmetric (JWKS) path algorithm pinning', () => {
  beforeEach(() => {
    mJwks.getKey.mockReset();
  });

  it('accepts a validly signed ES256 token (an allowed algorithm)', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    mJwks.getKey.mockResolvedValue(publicKey);

    const token = await new SignJWT({ sub: 'user-asym-1' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer('https://test.supabase.co/auth/v1')
      .setAudience('authenticated')
      .sign(privateKey);

    const payload = await verifySupabaseAccessToken(token);
    expect(payload.sub).toBe('user-asym-1');
  });

  it('rejects a validly signed token whose header algorithm is outside the ES256/RS256 allowlist', async () => {
    // PS256 is a legitimate, well-supported JWS algorithm — this is a real key rotation to an
    // unpinned alg, not a malformed token, so it exercises the allowlist rather than jose's
    // baseline signature/format checks.
    const { publicKey, privateKey } = await generateKeyPair('PS256', { extractable: true });
    mJwks.getKey.mockResolvedValue(publicKey);

    const token = await new SignJWT({ sub: 'user-asym-2' })
      .setProtectedHeader({ alg: 'PS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(verifySupabaseAccessToken(token)).rejects.toThrow();
  });
});
