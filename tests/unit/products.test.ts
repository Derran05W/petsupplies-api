import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductCategory } from '@prisma/client';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock('../../src/services/productService.js', () => ({
  list: vi.fn(),
  getBySlug: vi.fn(),
}));

import * as productService from '../../src/services/productService.js';
import { createApp } from '../../src/app.js';

const mockListResult = {
  products: [
    {
      id: 'prod-1',
      slug: 'royal-canin',
      name: 'Royal Canin',
      description: 'Dog food',
      price: 5499,
      imageUrl: null,
      stock: 10,
      inStock: true,
      active: true,
      category: ProductCategory.DOG,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      images: [],
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
};

describe('GET /products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with shape { products, total, page, limit }', async () => {
    vi.mocked(productService.list).mockResolvedValue(mockListResult as never);

    const app = createApp();
    const res = await app.request('/products');

    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof mockListResult;
    expect(body).toHaveProperty('products');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('limit');
    expect(Array.isArray(body.products)).toBe(true);
  });

  it('passes query params to the service', async () => {
    vi.mocked(productService.list).mockResolvedValue({ ...mockListResult, products: [] });

    const app = createApp();
    await app.request('/products?category=DOG&page=2&limit=5&sort=price_asc');

    expect(productService.list).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'DOG',
        page: 2,
        limit: 5,
        sort: 'price_asc',
      }),
    );
  });

  it('returns 400 for invalid sort option', async () => {
    const app = createApp();
    const res = await app.request('/products?sort=invalid');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid category', async () => {
    const app = createApp();
    const res = await app.request('/products?category=INVALID');
    expect(res.status).toBe(400);
  });
});

describe('GET /products/:slug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with product data when found', async () => {
    const product = { ...mockListResult.products[0] };
    vi.mocked(productService.getBySlug).mockResolvedValue(product as never);

    const app = createApp();
    const res = await app.request('/products/royal-canin');

    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof product;
    expect(body.slug).toBe('royal-canin');
  });

  it('returns 404 for nonexistent slug', async () => {
    vi.mocked(productService.getBySlug).mockResolvedValue(null);

    const app = createApp();
    const res = await app.request('/products/nonexistent-slug');

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });
});
