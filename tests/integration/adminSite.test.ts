import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { createApp } from '../../src/app.js';

vi.mock('../../src/services/siteSettingsService.js', () => ({
  getSiteSettingsPublic: vi.fn(),
  updateSiteSettings: vi.fn(),
}));

vi.mock('../../src/services/storageService.js', () => ({
  createSiteAssetUploadUrl: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as siteSettingsService from '../../src/services/siteSettingsService.js';
import * as storageService from '../../src/services/storageService.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

const publicSettings = {
  freeShippingThresholdCents: 5000,
  flatShippingCents: 599,
  brandName: "Aileen's petstore",
  supportEmail: 'hello@aileenspetstore.com',
  tagline: "Food they'll actually love.",
  description: 'Thoughtfully sourced, vet-approved nutrition for every pet.',
  logoAccentWords: 1,
  socialInstagram: null,
  socialFacebook: null,
  socialTwitter: null,
  heroEyebrow: 'New season · vet approved',
  heroHeadline: "Food they'll actually love.",
  heroSubhead: 'Thoughtfully sourced, vet-approved nutrition for every pet.',
  heroImageUrl: '/images/hero-placeholder.jpg',
  heroPrimaryCtaLabel: 'Shop now',
  heroPrimaryCtaHref: '/products',
  heroSecondaryCtaLabel: 'Browse categories',
  heroSecondaryCtaHref: '#categories',
  brandValues: [{ title: 'Free shipping', body: 'On every order over $50.' }],
  rewardTiers: [{ thresholdCents: 5000, label: 'Silver' }],
};

async function token(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .sign(new TextEncoder().encode(SECRET));
}

function adminHeaders(tok: string) {
  return { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
}

function mockAdmin() {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'admin-1',
    role: 'ADMIN',
    email: 'admin@example.com',
  } as never);
}

function mockCustomer() {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'user-1',
    role: 'CUSTOMER',
    email: 'user@example.com',
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(siteSettingsService.getSiteSettingsPublic).mockResolvedValue(publicSettings);
});

describe('GET /site/settings', () => {
  it('returns public settings without auth', async () => {
    const app = createApp();
    const res = await app.request('/site/settings');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(publicSettings);
    expect(body).not.toHaveProperty('updatedBy');
  });
});

describe('PATCH /admin/site/settings', () => {
  it('returns 401 without auth', async () => {
    const app = createApp();
    const res = await app.request('/admin/site/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandName: 'New Name' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    mockCustomer();
    const app = createApp();
    const t = await token('user-1');
    const res = await app.request('/admin/site/settings', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({ brandName: 'New Name' }),
    });
    expect(res.status).toBe(403);
  });

  it('updates settings for admin', async () => {
    mockAdmin();
    const updated = { ...publicSettings, brandName: 'New Store' };
    vi.mocked(siteSettingsService.updateSiteSettings).mockResolvedValue(updated);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/site/settings', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({ brandName: 'New Store' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brandName).toBe('New Store');
    expect(siteSettingsService.updateSiteSettings).toHaveBeenCalledWith(
      { brandName: 'New Store' },
      'admin-1',
    );
  });

  it('updates reward tiers for admin (happy path)', async () => {
    mockAdmin();
    const rewardTiers = [
      { thresholdCents: 2500, label: 'Bronze' },
      { thresholdCents: 5000, label: 'Silver' },
    ];
    vi.mocked(siteSettingsService.updateSiteSettings).mockResolvedValue({
      ...publicSettings,
      rewardTiers,
    });

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/site/settings', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({ rewardTiers }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rewardTiers).toEqual(rewardTiers);
    expect(siteSettingsService.updateSiteSettings).toHaveBeenCalledWith({ rewardTiers }, 'admin-1');
  });

  it('rejects reward tiers with duplicate thresholds (400)', async () => {
    mockAdmin();
    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/site/settings', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({
        rewardTiers: [
          { thresholdCents: 5000, label: 'Silver' },
          { thresholdCents: 5000, label: 'Also Silver' },
        ],
      }),
    });

    expect(res.status).toBe(400);
    expect(siteSettingsService.updateSiteSettings).not.toHaveBeenCalled();
  });
});

describe('POST /admin/site/assets/upload-url', () => {
  it('returns 403 for non-admin', async () => {
    mockCustomer();
    const app = createApp();
    const t = await token('user-1');
    const res = await app.request('/admin/site/assets/upload-url', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({ filename: 'hero.jpg', contentType: 'image/jpeg' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns signed upload payload for admin', async () => {
    mockAdmin();
    vi.mocked(storageService.createSiteAssetUploadUrl).mockResolvedValue({
      uploadUrl: 'https://storage.example/upload',
      token: 'tok',
      objectKey: 'site/uuid/hero.jpg',
      publicUrl: 'https://storage.example/public/site/uuid/hero.jpg',
      maxBytes: 5_000_000,
    });

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/site/assets/upload-url', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({ filename: 'hero.jpg', contentType: 'image/jpeg' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.objectKey).toMatch(/^site\//);
    expect(storageService.createSiteAssetUploadUrl).toHaveBeenCalledWith({
      filename: 'hero.jpg',
      contentType: 'image/jpeg',
    });
  });
});
