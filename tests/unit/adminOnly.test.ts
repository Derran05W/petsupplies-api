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
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/lib/prisma.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

async function makeToken(sub: string, claims: Record<string, unknown> = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
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
    expect(prisma.user.update).not.toHaveBeenCalled();
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
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('self-heals CUSTOMER to ADMIN when JWT app_metadata is ADMIN', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-3',
      role: 'CUSTOMER',
      email: 'promote@example.com',
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'user-3',
      role: 'ADMIN',
      email: 'promote@example.com',
    } as never);

    const token = await makeToken('user-3', { app_metadata: { role: 'ADMIN' } });
    const res = await makeApp().request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-3' },
      data: { role: 'ADMIN' },
      select: { id: true, role: true, email: true },
    });
  });

  it('logs a structured audit line when auto-promoting a user to ADMIN (D2)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-3',
      role: 'CUSTOMER',
      email: 'promote@example.com',
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'user-3',
      role: 'ADMIN',
      email: 'promote@example.com',
    } as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const token = await makeToken('user-3', { app_metadata: { role: 'ADMIN' } });
    await makeApp().request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[admin_auto_promote]',
      JSON.stringify({
        userId: 'user-3',
        email: 'promote@example.com',
        op: 'adminOnly.autoPromote',
      }),
    );
    warnSpy.mockRestore();
  });

  it('does not log an audit line when a user is already ADMIN', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      role: 'ADMIN',
      email: 'admin@example.com',
    } as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const token = await makeToken('user-1');
    await makeApp().request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not self-heal from user_metadata ADMIN alone', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-4',
      role: 'CUSTOMER',
      email: 'meta@example.com',
    } as never);

    const token = await makeToken('user-4', { user_metadata: { role: 'ADMIN' } });
    const res = await makeApp().request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not found in DB', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const token = await makeToken('ghost-user');
    const res = await makeApp().request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
  });

  it('returns 403 with message when JWT app admin has no User row (non-prod)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const token = await makeToken('ghost-admin', { app_metadata: { role: 'ADMIN' } });
    const res = await makeApp().request('/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message?: string };
    expect(body.error).toBe('Forbidden');
    if (process.env.NODE_ENV !== 'production') {
      expect(body.message).toMatch(/sync_auth_user/i);
    }
  });
});
