import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { ProductCategory } from '@prisma/client';
import { createApp } from '../../src/app.js';

// Mock all service layers so no DB or network calls happen
vi.mock('../../src/services/adminProductService.js', () => ({
  listAdminProducts: vi.fn(),
  getAdminProductById: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  addProductImage: vi.fn(),
  updateProductImage: vi.fn(),
  deleteProductImage: vi.fn(),
  reorderProductImages: vi.fn(),
}));

vi.mock('../../src/services/storageService.js', () => ({
  createProductImageUploadUrl: vi.fn(),
}));

// adminOnly middleware loads user from DB
vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as adminProductService from '../../src/services/adminProductService.js';
import * as storageService from '../../src/services/storageService.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

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

const baseProduct = {
  id: 'prod-1',
  slug: 'test-product',
  name: 'Test Product',
  description: 'A product',
  price: 999,
  stock: 5,
  active: true,
  category: ProductCategory.DOG,
  tags: [],
  imageUrl: null,
  images: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  weightGrams: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  shipsSeparately: false,
  subscriptionEligible: false,
  avgRating: null,
  reviewCount: 0,
  stockAlertEpisode: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Auth guards ──────────────────────────────────────────────────────────────

describe('Admin products auth guards', () => {
  it('returns 401 without auth on GET /admin/products', async () => {
    const app = createApp();
    const res = await app.request('/admin/products');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user on GET /admin/products', async () => {
    mockCustomer();
    const app = createApp();
    const t = await token('user-1');
    const res = await app.request('/admin/products', {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth on POST /admin/products', async () => {
    const app = createApp();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /admin/products ──────────────────────────────────────────────────────

describe('GET /admin/products', () => {
  it('returns product list for admin', async () => {
    mockAdmin();
    vi.mocked(adminProductService.listAdminProducts).mockResolvedValue({
      products: [baseProduct],
      total: 1,
      page: 1,
      limit: 20,
    } as never);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products', {
      headers: { Authorization: `Bearer ${t}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.products).toHaveLength(1);
  });

  it('passes query params to service', async () => {
    mockAdmin();
    vi.mocked(adminProductService.listAdminProducts).mockResolvedValue({
      products: [],
      total: 0,
      page: 1,
      limit: 20,
    } as never);

    const app = createApp();
    const t = await token('admin-1');
    await app.request('/admin/products?active=false&category=CAT&page=2&limit=10', {
      headers: { Authorization: `Bearer ${t}` },
    });

    expect(adminProductService.listAdminProducts).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, category: 'CAT', page: 2, limit: 10 }),
    );
  });
});

// ─── GET /admin/products/:id ──────────────────────────────────────────────────

describe('GET /admin/products/:id', () => {
  it('returns product by id', async () => {
    mockAdmin();
    vi.mocked(adminProductService.getAdminProductById).mockResolvedValue(baseProduct as never);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1', {
      headers: { Authorization: `Bearer ${t}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('prod-1');
  });
});

// ─── POST /admin/products ─────────────────────────────────────────────────────

describe('POST /admin/products', () => {
  it('creates a product and returns 201', async () => {
    mockAdmin();
    vi.mocked(adminProductService.createProduct).mockResolvedValue(baseProduct as never);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({
        name: 'Test Product',
        description: 'A product',
        price: 999,
        category: 'DOG',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('prod-1');
  });

  it('returns 400 when required fields are missing', async () => {
    mockAdmin();
    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({ name: 'Missing fields' }),
    });

    expect(res.status).toBe(400);
    expect(adminProductService.createProduct).not.toHaveBeenCalled();
  });

  it('returns 400 when price is zero or negative', async () => {
    mockAdmin();
    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({
        name: 'Test',
        description: 'Desc',
        price: 0,
        category: 'DOG',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when body includes subscriptionEligible (use PATCH /subscription instead)', async () => {
    mockAdmin();
    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({
        name: 'Sub Product',
        description: 'Desc',
        price: 999,
        category: 'DOG',
        subscriptionEligible: true,
      }),
    });

    expect(res.status).toBe(400);
    expect(adminProductService.createProduct).not.toHaveBeenCalled();
  });

  it('returns 409 when slug already exists', async () => {
    mockAdmin();
    const { HTTPException } = await import('hono/http-exception');
    vi.mocked(adminProductService.createProduct).mockRejectedValue(
      new HTTPException(409, { message: 'Slug "test-product" already exists' }),
    );

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({
        name: 'Test Product',
        description: 'A product',
        price: 999,
        category: 'DOG',
        slug: 'test-product',
      }),
    });

    expect(res.status).toBe(409);
  });
});

// ─── PATCH /admin/products/:id ────────────────────────────────────────────────

describe('PATCH /admin/products/:id', () => {
  it('updates product and returns 200', async () => {
    mockAdmin();
    vi.mocked(adminProductService.updateProduct).mockResolvedValue({
      ...baseProduct,
      price: 1299,
    } as never);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({ price: 1299 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.price).toBe(1299);
  });

  it('can update tags array', async () => {
    mockAdmin();
    vi.mocked(adminProductService.updateProduct).mockResolvedValue({
      ...baseProduct,
      tags: ['sale', 'featured'],
    } as never);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({ tags: ['sale', 'featured'] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toEqual(['sale', 'featured']);
  });

  it('returns 409 on slug conflict', async () => {
    mockAdmin();
    const { HTTPException } = await import('hono/http-exception');
    vi.mocked(adminProductService.updateProduct).mockRejectedValue(
      new HTTPException(409, { message: 'Slug exists' }),
    );

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({ slug: 'taken-slug' }),
    });

    expect(res.status).toBe(409);
  });

  it('returns 404 when product not found', async () => {
    mockAdmin();
    const { HTTPException } = await import('hono/http-exception');
    vi.mocked(adminProductService.updateProduct).mockRejectedValue(
      new HTTPException(404, { message: 'Product not found' }),
    );

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/missing', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({ price: 100 }),
    });

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /admin/products/:id ───────────────────────────────────────────────

describe('DELETE /admin/products/:id', () => {
  it('returns 200 with soft delete result', async () => {
    mockAdmin();
    vi.mocked(adminProductService.deleteProduct).mockResolvedValue({ deleted: 'soft' });

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe('soft');
  });

  it('returns 200 with hard delete result', async () => {
    mockAdmin();
    vi.mocked(adminProductService.deleteProduct).mockResolvedValue({ deleted: 'hard' });

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe('hard');
  });

  it('returns 404 when product not found', async () => {
    mockAdmin();
    const { HTTPException } = await import('hono/http-exception');
    vi.mocked(adminProductService.deleteProduct).mockRejectedValue(
      new HTTPException(404, { message: 'Product not found' }),
    );

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/missing', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}` },
    });

    expect(res.status).toBe(404);
  });
});

// ─── POST /admin/products/images/upload-url ───────────────────────────────────

describe('POST /admin/products/images/upload-url', () => {
  it('returns presigned upload URL', async () => {
    mockAdmin();
    vi.mocked(storageService.createProductImageUploadUrl).mockResolvedValue({
      uploadUrl: 'https://storage.example.com/upload',
      token: 'tok-1',
      objectKey: 'products/uuid/file.jpg',
      publicUrl: 'https://storage.example.com/public/products/uuid/file.jpg',
      maxBytes: 5_000_000,
    });

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/images/upload-url', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({ filename: 'photo.jpg', contentType: 'image/jpeg' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.uploadUrl).toBe('https://storage.example.com/upload');
    expect(body.maxBytes).toBe(5_000_000);
  });

  it('returns 400 for unsupported content type', async () => {
    mockAdmin();
    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/images/upload-url', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({ filename: 'photo.bmp', contentType: 'image/bmp' }),
    });

    expect(res.status).toBe(400);
    expect(storageService.createProductImageUploadUrl).not.toHaveBeenCalled();
  });

  it('returns 401 without auth', async () => {
    const app = createApp();
    const res = await app.request('/admin/products/images/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'photo.jpg', contentType: 'image/jpeg' }),
    });
    expect(res.status).toBe(401);
  });
});

// ─── POST /admin/products/:id/images ─────────────────────────────────────────

describe('POST /admin/products/:id/images', () => {
  const mockImageRow = {
    id: 'img-1',
    productId: 'prod-1',
    url: 'https://example.com/img.jpg',
    altText: 'Alt text',
    sortOrder: 0,
    isPrimary: true,
  };

  it('attaches an image and returns 201', async () => {
    mockAdmin();
    vi.mocked(adminProductService.addProductImage).mockResolvedValue(mockImageRow as never);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1/images', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({
        url: 'https://example.com/img.jpg',
        altText: 'Alt text',
        isPrimary: true,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.isPrimary).toBe(true);
  });

  it('returns 400 for invalid URL', async () => {
    mockAdmin();
    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1/images', {
      method: 'POST',
      headers: adminHeaders(t),
      body: JSON.stringify({ url: 'not-a-url' }),
    });

    expect(res.status).toBe(400);
  });
});

// ─── PATCH /admin/products/:id/images/:imageId ────────────────────────────────

describe('PATCH /admin/products/:id/images/:imageId', () => {
  it('updates image and returns 200', async () => {
    mockAdmin();
    const updated = {
      id: 'img-1',
      productId: 'prod-1',
      url: 'https://example.com/img.jpg',
      altText: 'New alt',
      sortOrder: 1,
      isPrimary: false,
    };
    vi.mocked(adminProductService.updateProductImage).mockResolvedValue(updated as never);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1/images/img-1', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({ altText: 'New alt', sortOrder: 1 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.altText).toBe('New alt');
  });
});

// ─── DELETE /admin/products/:id/images/:imageId ───────────────────────────────

describe('DELETE /admin/products/:id/images/:imageId', () => {
  it('deletes image and returns 204', async () => {
    mockAdmin();
    vi.mocked(adminProductService.deleteProductImage).mockResolvedValue(undefined);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1/images/img-1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}` },
    });

    expect(res.status).toBe(204);
  });

  it('returns 404 when image not found', async () => {
    mockAdmin();
    const { HTTPException } = await import('hono/http-exception');
    vi.mocked(adminProductService.deleteProductImage).mockRejectedValue(
      new HTTPException(404, { message: 'Image not found' }),
    );

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1/images/missing', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}` },
    });

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /admin/products/:id/images/reorder ─────────────────────────────────

describe('PATCH /admin/products/:id/images/reorder', () => {
  it('reorders images and returns 200', async () => {
    mockAdmin();
    vi.mocked(adminProductService.reorderProductImages).mockResolvedValue(undefined);

    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1/images/reorder', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({
        items: [
          { id: 'img-1', sortOrder: 1 },
          { id: 'img-2', sortOrder: 0 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 400 when items array is empty', async () => {
    mockAdmin();
    const app = createApp();
    const t = await token('admin-1');
    const res = await app.request('/admin/products/prod-1/images/reorder', {
      method: 'PATCH',
      headers: adminHeaders(t),
      body: JSON.stringify({ items: [] }),
    });

    expect(res.status).toBe(400);
  });
});
