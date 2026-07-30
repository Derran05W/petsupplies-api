import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';

// Supabase's standard audience claim for a signed-in user's access token.
const EXPECTED_AUDIENCE = 'authenticated';

let remoteJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getSupabaseBaseUrl(): string {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  if (!base) {
    throw new Error('SUPABASE_URL is required to verify Supabase JWTs');
  }
  return base;
}

function getSupabaseJwks() {
  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(
      new URL(`${getSupabaseBaseUrl()}/auth/v1/.well-known/jwks.json`),
    );
  }
  return remoteJwks;
}

/**
 * Verify a Supabase access token. Legacy projects use HS256 + JWT secret;
 * newer projects sign with ES256/RS256 and publish keys at the Auth JWKS URL.
 *
 * The expected issuer is derived from `SUPABASE_URL` (`${SUPABASE_URL}/auth/v1`) and the
 * expected audience is Supabase's standard `authenticated` claim. Pinning both is
 * defense-in-depth against token-confusion (a validly-signed token from a different
 * issuer/audience can no longer be replayed here).
 * CAVEAT: if a project uses a custom auth domain or a non-standard audience, these must be
 * adjusted accordingly — verify against a real production access token before deploy.
 */
export async function verifySupabaseAccessToken(token: string): Promise<JWTPayload> {
  const { alg } = decodeProtectedHeader(token);
  const issuer = `${getSupabaseBaseUrl()}/auth/v1`;

  if (alg === 'HS256') {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new Error('SUPABASE_JWT_SECRET is required for HS256 tokens');
    }
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      issuer,
      audience: EXPECTED_AUDIENCE,
    });
    return payload;
  }

  // Pin algorithms to what Supabase asymmetric projects actually issue, so a JWKS entry
  // (now or after a future key rotation) can't be leveraged to verify an unexpected alg.
  const { payload } = await jwtVerify(token, getSupabaseJwks(), {
    algorithms: ['ES256', 'RS256'],
    issuer,
    audience: EXPECTED_AUDIENCE,
  });
  return payload;
}
