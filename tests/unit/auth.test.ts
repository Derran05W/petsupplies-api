import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { auth } from '../../src/middleware/auth.js';
import type { Variables } from '../../src/types/hono.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';

async function signToken(payload: Record<string, unknown>, secret = SECRET, expiresIn = '1h') {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub as string)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

function makeApp() {
  const app = new Hono<{ Variables: Variables }>();
  app.use('/protected/*', auth);
  app.get('/protected/me', (c) =>
    c.json({ userId: c.get('userId'), jwtAppAdmin: c.get('jwtAppAdmin') }),
  );
  return app;
}

describe('auth middleware', () => {
  it('passes with a valid JWT', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const token = await signToken({ sub: 'user-123' });
    const app = makeApp();

    const res = await app.request('/protected/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; jwtAppAdmin: boolean };
    expect(body.userId).toBe('user-123');
    expect(body.jwtAppAdmin).toBe(false);
  });

  it('sets jwtAppAdmin when app_metadata.role is ADMIN', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const token = await signToken({ sub: 'user-123', app_metadata: { role: 'ADMIN' } });
    const app = makeApp();

    const res = await app.request('/protected/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; jwtAppAdmin: boolean };
    expect(body.jwtAppAdmin).toBe(true);
  });

  it('returns 401 with no Authorization header', async () => {
    const app = makeApp();
    const res = await app.request('/protected/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a malformed token', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const app = makeApp();
    const res = await app.request('/protected/me', {
      headers: { Authorization: 'Bearer not.a.jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with an expired token', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const token = await signToken({ sub: 'user-123' }, SECRET, '-1s');
    const app = makeApp();
    const res = await app.request('/protected/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when signed with wrong secret', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const token = await signToken({ sub: 'user-123' }, 'wrong-secret-32chars-padding!!!');
    const app = makeApp();
    const res = await app.request('/protected/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});
