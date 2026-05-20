import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';

let remoteJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getSupabaseJwks() {
  if (!remoteJwks) {
    const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
    if (!base) {
      throw new Error('SUPABASE_URL is required to verify asymmetric Supabase JWTs');
    }
    remoteJwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
  }
  return remoteJwks;
}

/**
 * Verify a Supabase access token. Legacy projects use HS256 + JWT secret;
 * newer projects sign with ES256/RS256 and publish keys at the Auth JWKS URL.
 */
export async function verifySupabaseAccessToken(token: string): Promise<JWTPayload> {
  const { alg } = decodeProtectedHeader(token);

  if (alg === 'HS256') {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new Error('SUPABASE_JWT_SECRET is required for HS256 tokens');
    }
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });
    return payload;
  }

  const { payload } = await jwtVerify(token, getSupabaseJwks());
  return payload;
}
