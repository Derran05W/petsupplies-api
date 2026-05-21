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

vi.mock('../../src/services/featuredProductService.js', () => ({
  listFeaturedProducts: vi.fn(),
  replaceFeaturedProducts: vi.fn(),
}));

vi.mock('../../src/services/navService.js', () => ({
  getSiteNav: vi.fn(),
  replaceHeaderNav: vi.fn(),
  replaceFooterNav: vi.fn(),
}));

vi.mock('../../src/services/categoryStripService.js', () => ({
  listCategoryStrip: vi.fn(),
  replaceCategoryStrip: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as featuredProductService from '../../src/services/featuredProductService.js';
import * as navService from '../../src/services/navService.js';
import * as categoryStripService from '../../src/services/categoryStripService.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

const sampleProduct = {
  id: 'prod-1',
  slug: 'dog-food',
  name: 'Dog Food',
  price: 999,
  inStock: true,
};

const sampleNav = {
  header: [{ label: 'Home', href: '/', position: 0 }],
  footer: [
    {
      column: { key: 'shop', label: 'Shop', position: 0 },
      links: [{ label: 'All', href: '/products', position: 0 }],
    },
  ],
};

const sampleCategoryStrip = [
  {
    id: 'strip-1',
    label: 'Dogs',
    imageUrl: '/images/categories/dogs.jpg',
    href: '/products?category=DOG',
    position: 0,
    isActive: true,
  },
];

async function token(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
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
  vi.mocked(featuredProductService.listFeaturedProducts).mockResolvedValue([
    sampleProduct,
  ] as never);
  vi.mocked(navService.getSiteNav).mockResolvedValue(sampleNav);
  vi.mocked(categoryStripService.listCategoryStrip).mockResolvedValue(sampleCategoryStrip);
});

describe('GET /site/featured-products', () => {
  it('returns featured products without auth', async () => {
    const app = createApp();
    const res = await app.request('/site/featured-products');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([sampleProduct]);
  });
});

describe('GET /site/nav', () => {
  it('returns nav without auth', async () => {
    const app = createApp();
    const res = await app.request('/site/nav');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sampleNav);
  });
});

describe('GET /site/category-strip', () => {
  it('returns category strip without auth', async () => {
    const app = createApp();
    const res = await app.request('/site/category-strip');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sampleCategoryStrip);
  });
});

describe('PUT /admin/site/featured-products', () => {
  it('returns 401 without auth', async () => {
    const app = createApp();
    const res = await app.request('/admin/site/featured-products', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productIds: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    mockCustomer();
    const app = createApp();
    const t = await token('user-1');
    const res = await app.request('/admin/site/featured-products', {
      method: 'PUT',
      headers: adminHeaders(t),
      body: JSON.stringify({ productIds: [] }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when more than 8 product IDs', async () => {
    mockAdmin();
    const app = createApp();
    const t = await token('admin-1');
    const ids = Array.from({ length: 9 }, (_, i) => `prod-${i}`);
    const res = await app.request('/admin/site/featured-products', {
      method: 'PUT',
      headers: adminHeaders(t),
      body: JSON.stringify({ productIds: ids }),
    });
    expect(res.status).toBe(400);
  });

  it('replaces featured products for admin', async () => {
    mockAdmin();
    vi.mocked(featuredProductService.replaceFeaturedProducts).mockResolvedValue([
      sampleProduct,
    ] as never);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/site/featured-products', {
      method: 'PUT',
      headers: adminHeaders(t),
      body: JSON.stringify({ productIds: ['prod-1'] }),
    });

    expect(res.status).toBe(200);
    expect(featuredProductService.replaceFeaturedProducts).toHaveBeenCalledWith(['prod-1']);
  });
});

describe('PUT /admin/site/nav/header', () => {
  it('returns 400 for invalid href', async () => {
    mockAdmin();
    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/site/nav/header', {
      method: 'PUT',
      headers: adminHeaders(t),
      body: JSON.stringify([{ label: 'Bad', href: 'javascript:void(0)', position: 0 }]),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty label', async () => {
    mockAdmin();
    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/site/nav/header', {
      method: 'PUT',
      headers: adminHeaders(t),
      body: JSON.stringify([{ label: '   ', href: '/products', position: 0 }]),
    });
    expect(res.status).toBe(400);
  });

  it('replaces header nav for admin', async () => {
    mockAdmin();
    vi.mocked(navService.replaceHeaderNav).mockResolvedValue(sampleNav);
    const payload = [{ label: 'Shop', href: '/products', position: 0 }];

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/site/nav/header', {
      method: 'PUT',
      headers: adminHeaders(t),
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    expect(navService.replaceHeaderNav).toHaveBeenCalledWith(payload);
  });
});

describe('PUT /admin/site/nav/footer', () => {
  it('returns 403 for non-admin', async () => {
    mockCustomer();
    const app = createApp();
    const t = await token('user-1');
    const res = await app.request('/admin/site/nav/footer', {
      method: 'PUT',
      headers: adminHeaders(t),
      body: JSON.stringify(sampleNav.footer),
    });
    expect(res.status).toBe(403);
  });

  it('replaces footer nav for admin', async () => {
    mockAdmin();
    vi.mocked(navService.replaceFooterNav).mockResolvedValue(sampleNav);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/site/nav/footer', {
      method: 'PUT',
      headers: adminHeaders(t),
      body: JSON.stringify(sampleNav.footer),
    });

    expect(res.status).toBe(200);
    expect(navService.replaceFooterNav).toHaveBeenCalledWith(sampleNav.footer);
  });
});

describe('PUT /admin/site/category-strip', () => {
  it('replaces category strip for admin', async () => {
    mockAdmin();
    vi.mocked(categoryStripService.replaceCategoryStrip).mockResolvedValue(sampleCategoryStrip);
    const payload = [{ label: 'Dogs', href: '/products?category=DOG', position: 0 }];

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/site/category-strip', {
      method: 'PUT',
      headers: adminHeaders(t),
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    expect(categoryStripService.replaceCategoryStrip).toHaveBeenCalledWith(payload);
  });
});
