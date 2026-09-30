import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductCategory } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    productImage: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    orderItem: { count: vi.fn() },
    subscription: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as adminProductService from '../../src/services/adminProductService.js';

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
  avgRating: null,
  reviewCount: 0,
  tags: [],
  weightGrams: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  shipsSeparately: false,
  subscriptionEligible: false,
  stockAlertEpisode: 0,
  images: [],
  ...overrides,
});

const mockImage = (overrides: Record<string, unknown> = {}) => ({
  id: 'img-1',
  productId: 'prod-1',
  url: 'https://example.com/image.jpg',
  altText: null,
  sortOrder: 0,
  isPrimary: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── listAdminProducts ────────────────────────────────────────────────────────

describe('adminProductService.listAdminProducts', () => {
  it('returns all products (including inactive) by default', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProduct()] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(1);

    const result = await adminProductService.listAdminProducts({});

    expect(result.total).toBe(1);
    expect(result.products).toHaveLength(1);
    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).not.toHaveProperty('active');
  });

  it('filters by active=false when specified', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await adminProductService.listAdminProducts({ active: false });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({ active: false });
  });

  it('filters by category', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await adminProductService.listAdminProducts({ category: ProductCategory.CAT });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({ categories: { has: ProductCategory.CAT } });
  });

  it('searches by q using name/description icontains', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await adminProductService.listAdminProducts({ q: 'kibble' });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      where: { OR: unknown[] };
    };
    expect(call.where.OR).toBeDefined();
    expect(call.where.OR).toHaveLength(2);
  });
});

// ─── getAdminProductById ──────────────────────────────────────────────────────

describe('adminProductService.getAdminProductById', () => {
  it('returns product when found', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct() as never);
    const result = await adminProductService.getAdminProductById('prod-1');
    expect(result.id).toBe('prod-1');
  });

  it('throws 404 when product not found', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    await expect(adminProductService.getAdminProductById('missing')).rejects.toThrow(HTTPException);
  });
});

// ─── createProduct ────────────────────────────────────────────────────────────

describe('adminProductService.createProduct', () => {
  it('creates product with auto-generated slug from name', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null); // no slug conflict
    vi.mocked(prisma.product.create).mockResolvedValue(
      mockProduct({ slug: 'royal-canin' }) as never,
    );

    const result = await adminProductService.createProduct({
      name: 'Royal Canin',
      description: 'Great dog food',
      price: 5499,
      category: ProductCategory.DOG,
    });

    expect(result.slug).toBe('royal-canin');
    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { slug: string };
    };
    expect(createCall.data.slug).toBe('royal-canin');
  });

  it('uses provided slug when given', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockResolvedValue(
      mockProduct({ slug: 'custom-slug' }) as never,
    );

    await adminProductService.createProduct({
      name: 'Royal Canin',
      description: 'Dog food',
      price: 5499,
      category: ProductCategory.DOG,
      slug: 'custom-slug',
    });

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { slug: string };
    };
    expect(createCall.data.slug).toBe('custom-slug');
  });

  it('appends -1 to slug on first collision', async () => {
    vi.mocked(prisma.product.findUnique)
      .mockResolvedValueOnce({ id: 'other-prod' } as never) // 'royal-canin' taken
      .mockResolvedValueOnce(null); // 'royal-canin-1' free
    vi.mocked(prisma.product.create).mockResolvedValue(
      mockProduct({ slug: 'royal-canin-1' }) as never,
    );

    await adminProductService.createProduct({
      name: 'Royal Canin',
      description: 'Dog food',
      price: 5499,
      category: ProductCategory.DOG,
    });

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { slug: string };
    };
    expect(createCall.data.slug).toBe('royal-canin-1');
  });

  it('sets defaults: stock=0, active=true, tags=[]', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockResolvedValue(mockProduct() as never);

    await adminProductService.createProduct({
      name: 'Test',
      description: 'Test product',
      price: 100,
      category: ProductCategory.DOG,
    });

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { stock: number; active: boolean; tags: string[] };
    };
    expect(createCall.data.stock).toBe(0);
    expect(createCall.data.active).toBe(true);
    expect(createCall.data.tags).toEqual([]);
  });

  it('passes ingredients through, defaulting to null when omitted', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockResolvedValue(mockProduct() as never);

    await adminProductService.createProduct({
      name: 'Test',
      description: 'Test product',
      price: 100,
      category: ProductCategory.DOG,
      ingredients: 'Chicken, rice, vitamins',
    });

    const first = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { ingredients: string | null };
    };
    expect(first.data.ingredients).toBe('Chicken, rice, vitamins');

    vi.clearAllMocks();
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockResolvedValue(mockProduct() as never);

    await adminProductService.createProduct({
      name: 'Test',
      description: 'Test product',
      price: 100,
      category: ProductCategory.DOG,
    });

    const second = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { ingredients: string | null };
    };
    expect(second.data.ingredients).toBeNull();
  });

  it('resolves categories from explicit list and sets category=categories[0]', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockResolvedValue(mockProduct() as never);

    await adminProductService.createProduct({
      name: 'Multi',
      description: 'Multi category',
      price: 100,
      categories: [ProductCategory.DOG, ProductCategory.CAT],
    });

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { category: ProductCategory; categories: ProductCategory[] };
    };
    expect(createCall.data.categories).toEqual([ProductCategory.DOG, ProductCategory.CAT]);
    expect(createCall.data.category).toBe(ProductCategory.DOG);
  });

  it('dedupes categories preserving order', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockResolvedValue(mockProduct() as never);

    await adminProductService.createProduct({
      name: 'Dupe',
      description: 'Dupe categories',
      price: 100,
      categories: [ProductCategory.CAT, ProductCategory.DOG, ProductCategory.CAT],
    });

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { category: ProductCategory; categories: ProductCategory[] };
    };
    expect(createCall.data.categories).toEqual([ProductCategory.CAT, ProductCategory.DOG]);
    expect(createCall.data.category).toBe(ProductCategory.CAT);
  });

  it('derives categories from legacy single category when list omitted', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockResolvedValue(mockProduct() as never);

    await adminProductService.createProduct({
      name: 'Legacy',
      description: 'Legacy category',
      price: 100,
      category: ProductCategory.FISH,
    });

    const createCall = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { category: ProductCategory; categories: ProductCategory[] };
    };
    expect(createCall.data.category).toBe(ProductCategory.FISH);
    expect(createCall.data.categories).toEqual([ProductCategory.FISH]);
  });
});

// ─── updateProduct ────────────────────────────────────────────────────────────

describe('adminProductService.updateProduct', () => {
  it('partially updates only provided fields', async () => {
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct({ price: 9999 }) as never);

    await adminProductService.updateProduct('prod-1', { price: 9999 });

    const updateCall = vi.mocked(prisma.product.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data).toMatchObject({ price: 9999 });
    expect(updateCall.data).not.toHaveProperty('name');
  });

  it('throws 409 when slug conflicts with another product', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'other-prod' } as never);

    await expect(
      adminProductService.updateProduct('prod-1', { slug: 'taken-slug' }),
    ).rejects.toThrow(HTTPException);
  });

  it('allows slug update to own current slug (same id)', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct() as never);

    await adminProductService.updateProduct('prod-1', { slug: 'royal-canin' });

    expect(prisma.product.update).toHaveBeenCalled();
  });

  it('throws 404 when product not found', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(prisma.product.update).mockRejectedValue(
      Object.assign(
        new Prisma.PrismaClientKnownRequestError('Not found', {
          code: 'P2025',
          clientVersion: '5.0.0',
        }),
      ),
    );

    await expect(adminProductService.updateProduct('missing', { price: 100 })).rejects.toThrow(
      HTTPException,
    );
  });

  it('sets ingredients when provided (including null to clear)', async () => {
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct() as never);

    await adminProductService.updateProduct('prod-1', { ingredients: 'Salmon, peas' });
    let call = vi.mocked(prisma.product.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data.ingredients).toBe('Salmon, peas');

    vi.mocked(prisma.product.update).mockClear();
    await adminProductService.updateProduct('prod-1', { ingredients: null });
    call = vi.mocked(prisma.product.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.ingredients).toBeNull();
  });

  it('does not touch ingredients or category when omitted', async () => {
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct() as never);

    await adminProductService.updateProduct('prod-1', { price: 500 });
    const call = vi.mocked(prisma.product.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data).not.toHaveProperty('ingredients');
    expect(call.data).not.toHaveProperty('category');
    expect(call.data).not.toHaveProperty('categories');
  });

  it('when categories provided, sets both categories (deduped) and category=categories[0]', async () => {
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct() as never);

    await adminProductService.updateProduct('prod-1', {
      categories: [ProductCategory.CAT, ProductCategory.DOG, ProductCategory.CAT],
    });
    const call = vi.mocked(prisma.product.update).mock.calls[0][0] as {
      data: { category: ProductCategory; categories: ProductCategory[] };
    };
    expect(call.data.categories).toEqual([ProductCategory.CAT, ProductCategory.DOG]);
    expect(call.data.category).toBe(ProductCategory.CAT);
  });

  it('when only legacy category provided, sets category and categories=[category]', async () => {
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct() as never);

    await adminProductService.updateProduct('prod-1', { category: ProductCategory.BIRD });
    const call = vi.mocked(prisma.product.update).mock.calls[0][0] as {
      data: { category: ProductCategory; categories: ProductCategory[] };
    };
    expect(call.data.category).toBe(ProductCategory.BIRD);
    expect(call.data.categories).toEqual([ProductCategory.BIRD]);
  });
});

// ─── deleteProduct ────────────────────────────────────────────────────────────

describe('adminProductService.deleteProduct', () => {
  it('soft-deletes (active=false) when product has order items', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.orderItem.count).mockResolvedValue(3);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct({ active: false }) as never);

    const result = await adminProductService.deleteProduct('prod-1');

    expect(result.deleted).toBe('soft');
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { active: false },
    });
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  it('soft-deletes when product has active subscriptions', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.orderItem.count).mockResolvedValue(0);
    vi.mocked(prisma.subscription.count).mockResolvedValue(1);
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct({ active: false }) as never);

    const result = await adminProductService.deleteProduct('prod-1');

    expect(result.deleted).toBe('soft');
  });

  it('hard-deletes when product has no order items or subscriptions', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.orderItem.count).mockResolvedValue(0);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.product.delete).mockResolvedValue(mockProduct() as never);

    const result = await adminProductService.deleteProduct('prod-1');

    expect(result.deleted).toBe('hard');
    expect(prisma.product.delete).toHaveBeenCalledWith({ where: { id: 'prod-1' } });
  });

  it('throws 404 when product not found', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    await expect(adminProductService.deleteProduct('missing')).rejects.toThrow(HTTPException);
  });
});

// ─── addProductImage ──────────────────────────────────────────────────────────

describe('adminProductService.addProductImage', () => {
  it('creates image without primary logic when isPrimary is false', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.productImage.create).mockResolvedValue(mockImage() as never);

    const result = await adminProductService.addProductImage('prod-1', {
      url: 'https://example.com/a.jpg',
    });

    expect(result.id).toBe('img-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses transaction to unset other primaries when isPrimary=true', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    const newImage = mockImage({ isPrimary: true });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') {
        const tx = {
          productImage: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn().mockResolvedValue(newImage),
          },
        };
        return fn(tx);
      }
      return fn;
    });

    const result = await adminProductService.addProductImage('prod-1', {
      url: 'https://example.com/a.jpg',
      isPrimary: true,
    });

    expect(result.isPrimary).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('throws 404 when product not found', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    await expect(
      adminProductService.addProductImage('missing', { url: 'https://example.com/a.jpg' }),
    ).rejects.toThrow(HTTPException);
  });
});

// ─── updateProductImage ───────────────────────────────────────────────────────

describe('adminProductService.updateProductImage', () => {
  it('uses transaction when setting isPrimary=true', async () => {
    vi.mocked(prisma.productImage.findUnique).mockResolvedValue(mockImage() as never);
    const updatedImage = mockImage({ isPrimary: true, altText: 'New alt' });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') {
        const tx = {
          productImage: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            update: vi.fn().mockResolvedValue(updatedImage),
          },
        };
        return fn(tx);
      }
      return fn;
    });

    const result = await adminProductService.updateProductImage('img-1', {
      isPrimary: true,
      altText: 'New alt',
    });

    expect(result.isPrimary).toBe(true);
  });

  it('throws 404 when image not found', async () => {
    vi.mocked(prisma.productImage.findUnique).mockResolvedValue(null);
    await expect(
      adminProductService.updateProductImage('missing', { altText: 'x' }),
    ).rejects.toThrow(HTTPException);
  });
});

// ─── deleteProductImage ───────────────────────────────────────────────────────

describe('adminProductService.deleteProductImage', () => {
  it('deletes image successfully', async () => {
    vi.mocked(prisma.productImage.delete).mockResolvedValue(mockImage() as never);
    await expect(adminProductService.deleteProductImage('img-1')).resolves.toBeUndefined();
  });

  it('throws 404 when image not found', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(prisma.productImage.delete).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      }),
    );
    await expect(adminProductService.deleteProductImage('missing')).rejects.toThrow(HTTPException);
  });
});

// ─── reorderProductImages ─────────────────────────────────────────────────────

describe('adminProductService.reorderProductImages', () => {
  it('throws 404 when product not found', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    await expect(
      adminProductService.reorderProductImages('missing', [{ id: 'img-1', sortOrder: 0 }]),
    ).rejects.toThrow(HTTPException);
  });

  it('calls $transaction with update calls for each item', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([]);
    vi.mocked(prisma.productImage.update).mockResolvedValue(mockImage() as never);

    await adminProductService.reorderProductImages('prod-1', [
      { id: 'img-1', sortOrder: 1 },
      { id: 'img-2', sortOrder: 0 },
    ]);

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
