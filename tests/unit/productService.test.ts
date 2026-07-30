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

import { prisma } from '../../src/lib/prisma.js';
import * as productService from '../../src/services/productService.js';

const mockProduct = (overrides: Record<string, unknown> = {}) => ({
  id: 'prod-1',
  slug: 'royal-canin',
  name: 'Royal Canin',
  description: 'Dog food',
  price: 5499,
  imageUrl: null,
  stock: 10,
  active: true,
  category: ProductCategory.DOG,
  searchVector: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  avgRating: null as number | null,
  reviewCount: 0,
  images: [],
  ...overrides,
});

describe('productService.list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated products with default page/limit', async () => {
    const products = [mockProduct()];
    vi.mocked(prisma.product.findMany).mockResolvedValue(products as never);
    vi.mocked(prisma.product.count).mockResolvedValue(1);

    const result = await productService.list({});

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.total).toBe(1);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].inStock).toBe(true);
  });

  it('respects custom page and limit', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    const result = await productService.list({ page: 3, limit: 5 });

    expect(result.page).toBe(3);
    expect(result.limit).toBe(5);
    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      skip: number;
      take: number;
    };
    expect(call.skip).toBe(10);
    expect(call.take).toBe(5);
  });

  it('caps limit at 100', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await productService.list({ limit: 999 });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as { take: number };
    expect(call.take).toBe(100);
  });

  it('filters by category', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await productService.list({ category: ProductCategory.CAT });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({ categories: { has: ProductCategory.CAT } });
  });

  it('filters by price range', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await productService.list({ minPrice: 1000, maxPrice: 5000 });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      where: { price: { gte: number; lte: number } };
    };
    expect(call.where.price).toEqual({ gte: 1000, lte: 5000 });
  });

  it('sorts by price_asc', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await productService.list({ sort: 'price_asc' });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: Record<string, string>;
    };
    expect(call.orderBy).toEqual({ price: 'asc' });
  });

  it('sorts by price_desc', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await productService.list({ sort: 'price_desc' });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: Record<string, string>;
    };
    expect(call.orderBy).toEqual({ price: 'desc' });
  });

  it('sorts by newest', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await productService.list({ sort: 'newest' });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: Record<string, string>;
    };
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('sorts by popularity (falls back to createdAt desc)', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await productService.list({ sort: 'popularity' });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: Record<string, string>;
    };
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('returns empty products array when no results', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    const result = await productService.list({});

    expect(result.products).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('uses raw SQL for full-text search and returns matching products', async () => {
    const product = mockProduct();
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([{ id: 'prod-1' }] as never)
      .mockResolvedValueOnce([{ count: BigInt(1) }] as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([product] as never);

    const result = await productService.list({ q: 'royal canin' });

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(1);
    expect(result.products).toHaveLength(1);
  });

  it('full-text search filters category via array containment (bound param)', async () => {
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([{ id: 'prod-1' }] as never)
      .mockResolvedValueOnce([{ count: BigInt(1) }] as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProduct()] as never);

    await productService.list({ q: 'royal', category: ProductCategory.DOG });

    const rowsCall = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
    const sql = rowsCall[0] as string;
    expect(sql).toContain('= ANY("categories")');
    expect(sql).not.toContain('category =');
    // category is passed as a bound parameter, not interpolated
    expect(rowsCall.slice(1)).toContain(ProductCategory.DOG);
  });

  it('full-text search without category omits the array clause', async () => {
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never);

    await productService.list({ q: 'royal' });

    const rowsCall = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
    expect(rowsCall[0] as string).not.toContain('ANY("categories")');
    // q is always bound (as $1); with no category there is no second binding
    expect(rowsCall.slice(1)).toEqual(['royal']);
  });

  it('binds q as a parameter instead of interpolating it into the SQL text', async () => {
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([{ id: 'prod-1' }] as never)
      .mockResolvedValueOnce([{ count: BigInt(1) }] as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProduct()] as never);

    const result = await productService.list({ q: "dog's toy" });

    expect(result.total).toBe(1);
    const rowsCall = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
    const sql = rowsCall[0] as string;
    expect(sql).toContain("plainto_tsquery('english', $1)");
    // the raw value (quoted or escaped) must never appear inside the SQL text itself
    expect(sql).not.toContain("dog's toy");
    expect(sql).not.toContain("dog''s toy");
    expect(rowsCall.slice(1)).toEqual(["dog's toy"]);

    const countCall = vi.mocked(prisma.$queryRawUnsafe).mock.calls[1];
    expect(countCall.slice(1)).toEqual(["dog's toy"]);
  });

  it('treats a SQL-injection-shaped q as literal bound search text, not SQL', async () => {
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never);

    const payload = "x') OR '1'='1";
    const result = await productService.list({ q: payload });

    expect(result.products).toEqual([]);
    expect(result.total).toBe(0);
    const rowsCall = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
    const sql = rowsCall[0] as string;
    expect(sql).not.toContain(payload);
    // passed through as an opaque bound parameter value, never spliced into the query
    expect(rowsCall.slice(1)[0]).toBe(payload);
  });

  it('lines up q + category bindings positionally across both the rows and count queries', async () => {
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([{ id: 'prod-1' }] as never)
      .mockResolvedValueOnce([{ count: BigInt(1) }] as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProduct()] as never);

    await productService.list({ q: 'royal', category: ProductCategory.DOG });

    const rowsCall = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
    const countCall = vi.mocked(prisma.$queryRawUnsafe).mock.calls[1];
    expect(rowsCall[0] as string).toContain("plainto_tsquery('english', $1)");
    expect(rowsCall[0] as string).toContain('$2 = ANY("categories")');
    expect(rowsCall.slice(1)).toEqual(['royal', ProductCategory.DOG]);
    expect(countCall.slice(1)).toEqual(['royal', ProductCategory.DOG]);
  });

  it('returns empty when full-text search finds no matches', async () => {
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never);

    const result = await productService.list({ q: 'zzznonexistent' });

    expect(result.products).toEqual([]);
    expect(result.total).toBe(0);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('sets inStock=false when stock is 0', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProduct({ stock: 0 })] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(1);

    const result = await productService.list({});

    expect(result.products[0].inStock).toBe(false);
  });

  it('exposes avgRating and reviewCount on list results', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      mockProduct({ avgRating: 4.5, reviewCount: 12 }),
    ] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(1);

    const result = await productService.list({});

    expect(result.products[0].avgRating).toBe(4.5);
    expect(result.products[0].reviewCount).toBe(12);
  });

  it('sorts by rating_desc with avgRating nulls last', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await productService.list({ sort: 'rating_desc' });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: Record<string, unknown>;
    };
    expect(call.orderBy).toEqual({ avgRating: { sort: 'desc', nulls: 'last' } });
  });

  it('sorts by rating_asc with avgRating nulls last', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await productService.list({ sort: 'rating_asc' });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: Record<string, unknown>;
    };
    expect(call.orderBy).toEqual({ avgRating: { sort: 'asc', nulls: 'last' } });
  });

  it('?q= search composes with sort=rating_desc', async () => {
    const product = mockProduct();
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([{ id: 'prod-1' }] as never)
      .mockResolvedValueOnce([{ count: BigInt(1) }] as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([product] as never);

    await productService.list({ q: 'royal', sort: 'rating_desc' });

    const rawCall = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(rawCall).toContain('"avgRating" DESC NULLS LAST');
    const findCall = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: Record<string, unknown>;
    };
    expect(findCall.orderBy).toEqual({ avgRating: { sort: 'desc', nulls: 'last' } });
  });
});

describe('productService.getBySlug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the product with inStock when found and active', async () => {
    const product = mockProduct({ active: true, stock: 5 });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const result = await productService.getBySlug('royal-canin');

    expect(result).not.toBeNull();
    expect(result!.inStock).toBe(true);
    expect(result!.slug).toBe('royal-canin');
  });

  it('returns null when product is not found', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

    const result = await productService.getBySlug('nonexistent-slug');

    expect(result).toBeNull();
  });

  it('returns null for inactive products', async () => {
    const product = mockProduct({ active: false });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const result = await productService.getBySlug('inactive-product');

    expect(result).toBeNull();
  });

  it('exposes avgRating and reviewCount on getBySlug result', async () => {
    const product = mockProduct({ avgRating: 3.25, reviewCount: 4 });
    vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);

    const result = await productService.getBySlug('royal-canin');

    expect(result).not.toBeNull();
    expect(result!.avgRating).toBe(3.25);
    expect(result!.reviewCount).toBe(4);
  });
});
