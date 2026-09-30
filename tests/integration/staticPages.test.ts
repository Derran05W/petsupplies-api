import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { createApp } from '../../src/app.js';

vi.mock('../../src/services/staticPageService.js', () => ({
  getPublishedStaticPage: vi.fn(),
  listAdminStaticPages: vi.fn(),
  upsertStaticPage: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as staticPageService from '../../src/services/staticPageService.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

async function adminToken() {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'admin-1',
    role: 'ADMIN',
    email: 'admin@example.com',
  } as never);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('admin-1')
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .sign(new TextEncoder().encode(SECRET));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /site/pages/:slug', () => {
  it('returns published page without auth', async () => {
    vi.mocked(staticPageService.getPublishedStaticPage).mockResolvedValue({
      slug: 'about',
      title: 'About us',
      bodyMarkdown: '# Hello',
      updatedAt: '2026-05-20T00:00:00.000Z',
    });
    const app = createApp();
    const res = await app.request('/site/pages/about');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      slug: 'about',
      title: 'About us',
      bodyMarkdown: '# Hello',
      updatedAt: '2026-05-20T00:00:00.000Z',
    });
    expect(body).not.toHaveProperty('isPublished');
  });

  it('returns 404 when unpublished', async () => {
    vi.mocked(staticPageService.getPublishedStaticPage).mockResolvedValue(null);
    const app = createApp();
    const res = await app.request('/site/pages/about');
    expect(res.status).toBe(404);
  });
});

describe('GET /admin/site/pages', () => {
  it('lists pages for admin', async () => {
    vi.mocked(staticPageService.listAdminStaticPages).mockResolvedValue([
      {
        slug: 'about',
        title: 'About us',
        bodyMarkdown: '',
        isPublished: false,
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
    ]);
    const token = await adminToken();
    const app = createApp();
    const res = await app.request('/admin/site/pages', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pages[0].isPublished).toBe(false);
  });
});

describe('PUT /admin/site/pages/:slug', () => {
  it('upserts page for admin', async () => {
    vi.mocked(staticPageService.upsertStaticPage).mockResolvedValue({
      slug: 'about',
      title: 'About',
      bodyMarkdown: 'Copy',
      isPublished: true,
      updatedAt: '2026-05-20T00:00:00.000Z',
    });
    const token = await adminToken();
    const app = createApp();
    const res = await app.request('/admin/site/pages/about', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'About',
        bodyMarkdown: 'Copy',
        isPublished: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(staticPageService.upsertStaticPage).toHaveBeenCalledWith(
      'about',
      { title: 'About', bodyMarkdown: 'Copy', isPublished: true },
      'admin-1',
    );
  });
});
