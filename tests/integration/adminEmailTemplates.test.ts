import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { createApp } from '../../src/app.js';

vi.mock('../../src/services/emailTemplateService.js', () => ({
  listAdminEmailTemplates: vi.fn(),
  getAdminEmailTemplate: vi.fn(),
  upsertEmailTemplate: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as emailTemplateService from '../../src/services/emailTemplateService.js';

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

describe('admin email template routes', () => {
  it('GET /admin/site/email-templates lists templates', async () => {
    vi.mocked(emailTemplateService.listAdminEmailTemplates).mockResolvedValue([
      {
        key: 'order-confirmation',
        subject: 'Your {{brand.name}} order is confirmed',
        preheader: null,
        updatedAt: '2026-05-20T00:00:00.000Z',
      },
    ]);
    const token = await adminToken();
    const app = createApp();
    const res = await app.request('/admin/site/email-templates', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0]).not.toHaveProperty('bodyMarkdown');
  });

  it('PUT /admin/site/email-templates/:key upserts template', async () => {
    vi.mocked(emailTemplateService.upsertEmailTemplate).mockResolvedValue({
      key: 'order-confirmation',
      subject: 'Updated subject',
      preheader: null,
      bodyMarkdown: 'Body',
      updatedAt: '2026-05-20T00:00:00.000Z',
    });
    const token = await adminToken();
    const app = createApp();
    const res = await app.request('/admin/site/email-templates/order-confirmation', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: 'Updated subject',
        bodyMarkdown: 'Body',
      }),
    });
    expect(res.status).toBe(200);
    expect(emailTemplateService.upsertEmailTemplate).toHaveBeenCalledWith('order-confirmation', {
      subject: 'Updated subject',
      bodyMarkdown: 'Body',
    });
  });
});
