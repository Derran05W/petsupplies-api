import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { createApp } from '../../src/app.js';

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

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as adminProductService from '../../src/services/adminProductService.js';
import * as storageService from '../../src/services/storageService.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

async function adminToken() {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('admin-1')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

function authHeaders(tok: string) {
  return { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'admin-1',
    role: 'ADMIN',
    email: 'admin@example.com',
  } as never);
});

const validCreate = {
  name: 'Test',
  description: 'Desc',
  price: 100,
  category: 'DOG',
};

// ─── POST /admin/products field validation ────────────────────────────────────

describe('POST /admin/products schema validation', () => {
  it('400: name too long (>200)', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, name: 'a'.repeat(201) }),
    });
    expect(res.status).toBe(400);
  });

  it('400: description too long (>10000)', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, description: 'd'.repeat(10_001) }),
    });
    expect(res.status).toBe(400);
  });

  it('400: negative price', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, price: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it('400: non-integer price', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, price: 99.99 }),
    });
    expect(res.status).toBe(400);
  });

  it('400: negative stock', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, stock: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it('400: invalid category enum', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, category: 'ALIEN' }),
    });
    expect(res.status).toBe(400);
  });

  it('400: slug with uppercase characters', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, slug: 'Bad-Slug' }),
    });
    expect(res.status).toBe(400);
  });

  it('400: slug with underscore or spaces', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, slug: 'bad_slug here' }),
    });
    expect(res.status).toBe(400);
  });

  it('400: more than 30 tags', async () => {
    const app = createApp();
    const t = await adminToken();
    const tags = Array.from({ length: 31 }, (_, i) => `tag-${i}`);
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, tags }),
    });
    expect(res.status).toBe(400);
  });

  it('400: tag longer than 40 chars', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, tags: ['a'.repeat(41)] }),
    });
    expect(res.status).toBe(400);
  });

  it('400: weightGrams out of bounds (0)', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, weightGrams: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('400: weightGrams out of bounds (>50000)', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, weightGrams: 50_001 }),
    });
    expect(res.status).toBe(400);
  });

  it('400: lengthCm out of bounds (>200)', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, lengthCm: 201 }),
    });
    expect(res.status).toBe(400);
  });

  it('400: unknown extra field is rejected by strict()', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, foo: 'bar' }),
    });
    expect(res.status).toBe(400);
  });

  it('400: imageUrl that is not a URL', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ ...validCreate, imageUrl: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
  });

  it('201: accepts every supported package field', async () => {
    vi.mocked(adminProductService.createProduct).mockResolvedValue({
      id: 'prod-x',
    } as never);

    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({
        ...validCreate,
        weightGrams: 100,
        lengthCm: 10,
        widthCm: 5,
        heightCm: 3,
        shipsSeparately: true,
        tags: ['sale'],
        imageUrl: 'https://example.com/x.jpg',
        slug: 'good-slug',
        stock: 5,
        active: false,
      }),
    });
    expect(res.status).toBe(201);
  });
});

// ─── PATCH /admin/products/:id validation ─────────────────────────────────────

describe('PATCH /admin/products/:id schema validation', () => {
  it('400: subscriptionEligible in PATCH body rejected (strict)', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({ subscriptionEligible: true }),
    });
    expect(res.status).toBe(400);
    expect(adminProductService.updateProduct).not.toHaveBeenCalled();
  });

  it('400: unknown extra field rejected by strict()', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({ foo: 'bar' }),
    });
    expect(res.status).toBe(400);
  });

  it('200: PATCH with imageUrl=null clears it', async () => {
    vi.mocked(adminProductService.updateProduct).mockResolvedValue({
      id: 'prod-1',
      imageUrl: null,
    } as never);

    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({ imageUrl: null }),
    });
    expect(res.status).toBe(200);
    expect(adminProductService.updateProduct).toHaveBeenCalledWith(
      'prod-1',
      expect.objectContaining({ imageUrl: null }),
    );
  });

  it('200: PATCH with empty body is accepted (idempotent no-op)', async () => {
    vi.mocked(adminProductService.updateProduct).mockResolvedValue({ id: 'prod-1' } as never);

    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});

// ─── Listing query validation ─────────────────────────────────────────────────

describe('GET /admin/products query validation', () => {
  it('400: limit > 100 rejected', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products?limit=101', {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status).toBe(400);
  });

  it('400: page=0 rejected (positive())', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products?page=0', {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status).toBe(400);
  });

  it('400: invalid category enum in query', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products?category=NOPE', {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status).toBe(400);
  });

  it('400: active="bad" rejected (only "true"/"false" allowed)', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products?active=bad', {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status).toBe(400);
  });
});

// ─── Upload-URL endpoint validation ───────────────────────────────────────────

describe('POST /admin/products/images/upload-url validation', () => {
  it('400: missing filename', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/images/upload-url', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ contentType: 'image/jpeg' }),
    });
    expect(res.status).toBe(400);
  });

  it('400: filename longer than 255 chars', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/images/upload-url', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({
        filename: 'x'.repeat(256) + '.jpg',
        contentType: 'image/jpeg',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('400: extra unknown field rejected', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/images/upload-url', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({
        filename: 'x.jpg',
        contentType: 'image/jpeg',
        evil: 'payload',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('502: Supabase error bubbles up through the route', async () => {
    const { HTTPException } = await import('hono/http-exception');
    vi.mocked(storageService.createProductImageUploadUrl).mockRejectedValue(
      new HTTPException(502, { message: 'Storage error' }),
    );

    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/images/upload-url', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ filename: 'x.jpg', contentType: 'image/jpeg' }),
    });
    expect(res.status).toBe(502);
  });
});

// ─── Add-image endpoint validation ────────────────────────────────────────────

describe('POST /admin/products/:id/images validation', () => {
  it('400: missing url', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1/images', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ altText: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('400: negative sortOrder', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1/images', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ url: 'https://x/y.jpg', sortOrder: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it('400: altText too long (>255)', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1/images', {
      method: 'POST',
      headers: authHeaders(t),
      body: JSON.stringify({ url: 'https://x/y.jpg', altText: 'a'.repeat(256) }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── Update-image endpoint validation ─────────────────────────────────────────

describe('PATCH /admin/products/:id/images/:imageId validation', () => {
  it('400: empty body rejected by .refine', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1/images/img-1', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(adminProductService.updateProductImage).not.toHaveBeenCalled();
  });

  it('404: bubble-up when image not on this product', async () => {
    const { HTTPException } = await import('hono/http-exception');
    vi.mocked(adminProductService.updateProductImage).mockRejectedValue(
      new HTTPException(404, { message: 'Image not found on this product' }),
    );

    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-WRONG/images/img-1', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({ altText: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('passes :id from path to service as expectedProductId', async () => {
    vi.mocked(adminProductService.updateProductImage).mockResolvedValue({
      id: 'img-1',
    } as never);

    const app = createApp();
    const t = await adminToken();
    await app.request('/admin/products/prod-42/images/img-1', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({ altText: 'x' }),
    });

    expect(adminProductService.updateProductImage).toHaveBeenCalledWith(
      'img-1',
      expect.objectContaining({ altText: 'x' }),
      'prod-42',
    );
  });
});

// ─── Delete-image cross-product guard ─────────────────────────────────────────

describe('DELETE /admin/products/:id/images/:imageId cross-product guard', () => {
  it('passes :id to service so cross-product calls 404', async () => {
    vi.mocked(adminProductService.deleteProductImage).mockResolvedValue(undefined);

    const app = createApp();
    const t = await adminToken();
    await app.request('/admin/products/prod-1/images/img-1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}` },
    });

    expect(adminProductService.deleteProductImage).toHaveBeenCalledWith('img-1', 'prod-1');
  });
});

// ─── Reorder validation ───────────────────────────────────────────────────────

describe('PATCH /admin/products/:id/images/reorder validation', () => {
  it('400: items array > 50', async () => {
    const app = createApp();
    const t = await adminToken();
    const items = Array.from({ length: 51 }, (_, i) => ({
      id: `img-${i}`,
      sortOrder: i,
    }));
    const res = await app.request('/admin/products/prod-1/images/reorder', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({ items }),
    });
    expect(res.status).toBe(400);
  });

  it('400: negative sortOrder in items', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1/images/reorder', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({
        items: [{ id: 'img-1', sortOrder: -1 }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('400: missing items field', async () => {
    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1/images/reorder', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('404: cross-product image id bubbles up', async () => {
    const { HTTPException } = await import('hono/http-exception');
    vi.mocked(adminProductService.reorderProductImages).mockRejectedValue(
      new HTTPException(404, { message: 'One or more images not found on this product' }),
    );

    const app = createApp();
    const t = await adminToken();
    const res = await app.request('/admin/products/prod-1/images/reorder', {
      method: 'PATCH',
      headers: authHeaders(t),
      body: JSON.stringify({ items: [{ id: 'img-other', sortOrder: 0 }] }),
    });
    expect(res.status).toBe(404);
  });
});
