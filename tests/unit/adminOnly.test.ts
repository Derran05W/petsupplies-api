import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { auth } from '../../src/middleware/auth.js';
import { adminOnly } from '../../src/middleware/adminOnly.js';
import type { Variables } from '../../src/types/hono.js';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/lib/prisma.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

async function makeToken(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

function makeApp() {
  const app = new Hono<{ Variables: Variables }>();
  app.use('/admin/*', auth, adminOnly);
  app.get('/admin/dashboard', (c) => c.json({ ok: true }));
  return app;
}

describe('adminOnly middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows ADMIN users through', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      role: 'ADMIN',
      email: 'admin@example.com',
    } as never);

    const token = await makeToken('user-1');
    const res = await makeApp().request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
  });

  it('returns 403 for CUSTOMER users', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-2',
      role: 'CUSTOMER',
      email: 'customer@example.com',
    } as never);

    const token = await makeToken('user-2');
    const res = await makeApp().request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
  });

  it('returns 403 when user is not found in DB', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const token = await makeToken('ghost-user');
    const res = await makeApp().request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
  });
});
