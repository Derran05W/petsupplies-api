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

const mockProduct = (o: Record<string, unknown> = {}) => ({
  id: 'prod-1',
  slug: 'royal-canin',
  name: 'Royal Canin',
  description: 'Dog food',
  price: 5499,
  imageUrl: null,
  stock: 10,
  active: true,
  category: ProductCategory.DOG,
  tags: [],
  weightGrams: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  shipsSeparately: false,
  subscriptionEligible: false,
  searchVector: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  avgRating: null,
  reviewCount: 0,
  stockAlertEpisode: 0,
  images: [],
  ...o,
});

const mockImage = (o: Record<string, unknown> = {}) => ({
  id: 'img-1',
  productId: 'prod-1',
  url: 'https://example.com/a.jpg',
  altText: null,
  sortOrder: 0,
  isPrimary: false,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── listAdminProducts pagination math ────────────────────────────────────────

describe('listAdminProducts pagination & clamping', () => {
  it('applies page/limit math: page=3 limit=15 → skip=30 take=15', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await adminProductService.listAdminProducts({ page: 3, limit: 15 });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      skip: number;
      take: number;
    };
    expect(call.skip).toBe(30);
    expect(call.take).toBe(15);
  });

  it('clamps limit above 100 down to 100', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);
    await adminProductService.listAdminProducts({ limit: 9999 });
    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as { take: number };
    expect(call.take).toBe(100);
  });

  it('clamps page <= 0 to 1', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);
    await adminProductService.listAdminProducts({ page: 0, limit: 20 });
    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as { skip: number };
    expect(call.skip).toBe(0);
  });

  it('combines q + category + active=true in the same where', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(0);

    await adminProductService.listAdminProducts({
      q: 'kibble',
      category: ProductCategory.DOG,
      active: true,
    });

    const call = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      where: { active?: boolean; categories?: { has?: string }; OR?: unknown[] };
    };
    expect(call.where.active).toBe(true);
    expect(call.where.categories).toEqual({ has: ProductCategory.DOG });
    expect(call.where.OR).toHaveLength(2);
  });
});

// ─── slugify behaviour via createProduct ──────────────────────────────────────

describe('createProduct slugify edge cases', () => {
  it('strips trailing hyphens after non-alphanumerics', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockImplementation(((args: { data: { slug: string } }) =>
      mockProduct({ slug: args.data.slug })) as never);

    await adminProductService.createProduct({
      name: '   Royal Canin!! ',
      description: 'x',
      price: 1,
      category: ProductCategory.DOG,
    });

    const { data } = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { slug: string };
    };
    expect(data.slug).toBe('royal-canin');
  });

  it('falls back to "product" when name has no alphanumerics', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockImplementation(((args: { data: { slug: string } }) =>
      mockProduct({ slug: args.data.slug })) as never);

    await adminProductService.createProduct({
      name: '@@@!!!',
      description: 'x',
      price: 1,
      category: ProductCategory.DOG,
    });

    const { data } = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { slug: string };
    };
    expect(data.slug).toBe('product');
  });

  it('iterates past first collision: -1 taken, picks -2', async () => {
    vi.mocked(prisma.product.findUnique)
      .mockResolvedValueOnce({ id: 'a' } as never)
      .mockResolvedValueOnce({ id: 'b' } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.product.create).mockImplementation(((args: { data: { slug: string } }) =>
      mockProduct({ slug: args.data.slug })) as never);

    await adminProductService.createProduct({
      name: 'Royal Canin',
      description: 'x',
      price: 1,
      category: ProductCategory.DOG,
    });

    const { data } = vi.mocked(prisma.product.create).mock.calls[0][0] as {
      data: { slug: string };
    };
    expect(data.slug).toBe('royal-canin-2');
  });

  it('translates P2002 race from prisma.create into 409', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );

    await expect(
      adminProductService.createProduct({
        name: 'Royal Canin',
        description: 'x',
        price: 1,
        category: ProductCategory.DOG,
      }),
    ).rejects.toThrow(HTTPException);
  });
});

// ─── updateProduct null clearing & all fields ─────────────────────────────────

describe('updateProduct field passthrough', () => {
  it('clears imageUrl when null is supplied', async () => {
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct({ imageUrl: null }) as never);

    await adminProductService.updateProduct('prod-1', { imageUrl: null });

    const { data } = vi.mocked(prisma.product.update).mock.calls[0][0] as {
      data: { imageUrl: string | null };
    };
    expect(data.imageUrl).toBeNull();
  });

  it('clears package dims when null is supplied', async () => {
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct() as never);

    await adminProductService.updateProduct('prod-1', {
      weightGrams: null,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
    });

    const { data } = vi.mocked(prisma.product.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.weightGrams).toBeNull();
    expect(data.lengthCm).toBeNull();
    expect(data.widthCm).toBeNull();
    expect(data.heightCm).toBeNull();
  });

  it('clears tags with empty array', async () => {
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct({ tags: [] }) as never);

    await adminProductService.updateProduct('prod-1', { tags: [] });

    const { data } = vi.mocked(prisma.product.update).mock.calls[0][0] as {
      data: { tags: string[] };
    };
    expect(data.tags).toEqual([]);
  });

  it('translates P2002 race from update into 409 with safe label when slug omitted', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(prisma.product.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );

    await expect(adminProductService.updateProduct('prod-1', { name: 'New' })).rejects.toThrow(
      HTTPException,
    );
  });

  it('empty patch object still calls prisma.update (idempotent)', async () => {
    vi.mocked(prisma.product.update).mockResolvedValue(mockProduct() as never);
    await adminProductService.updateProduct('prod-1', {});
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
    const { data } = vi.mocked(prisma.product.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(data)).toHaveLength(0);
  });
});

// ─── addProductImage edge cases ───────────────────────────────────────────────

describe('addProductImage edge cases', () => {
  it('creates non-primary image when isPrimary explicitly false', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.productImage.create).mockResolvedValue(mockImage() as never);

    await adminProductService.addProductImage('prod-1', {
      url: 'https://x/y.jpg',
      isPrimary: false,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    const { data } = vi.mocked(prisma.productImage.create).mock.calls[0][0] as {
      data: { isPrimary: boolean };
    };
    expect(data.isPrimary).toBe(false);
  });

  it('defaults sortOrder to 0 when omitted', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.productImage.create).mockResolvedValue(mockImage() as never);

    await adminProductService.addProductImage('prod-1', { url: 'https://x/y.jpg' });

    const { data } = vi.mocked(prisma.productImage.create).mock.calls[0][0] as {
      data: { sortOrder: number };
    };
    expect(data.sortOrder).toBe(0);
  });
});

// ─── updateProductImage cross-product guard ───────────────────────────────────

describe('updateProductImage cross-product guard', () => {
  it('throws 404 when expectedProductId does not match', async () => {
    vi.mocked(prisma.productImage.findUnique).mockResolvedValue(
      mockImage({ productId: 'prod-1' }) as never,
    );
    await expect(
      adminProductService.updateProductImage('img-1', { altText: 'x' }, 'prod-WRONG'),
    ).rejects.toThrow(HTTPException);
    expect(prisma.productImage.update).not.toHaveBeenCalled();
  });

  it('proceeds when expectedProductId matches', async () => {
    vi.mocked(prisma.productImage.findUnique).mockResolvedValue(
      mockImage({ productId: 'prod-1' }) as never,
    );
    vi.mocked(prisma.productImage.update).mockResolvedValue(mockImage({ altText: 'New' }) as never);

    const result = await adminProductService.updateProductImage(
      'img-1',
      { altText: 'New' },
      'prod-1',
    );
    expect(result.altText).toBe('New');
  });

  it('unsets isPrimary when false (no transaction)', async () => {
    vi.mocked(prisma.productImage.findUnique).mockResolvedValue(
      mockImage({ isPrimary: true }) as never,
    );
    vi.mocked(prisma.productImage.update).mockResolvedValue(
      mockImage({ isPrimary: false }) as never,
    );

    await adminProductService.updateProductImage('img-1', { isPrimary: false });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    const { data } = vi.mocked(prisma.productImage.update).mock.calls[0][0] as {
      data: { isPrimary?: boolean };
    };
    expect(data.isPrimary).toBe(false);
  });
});

// ─── deleteProductImage cross-product guard ───────────────────────────────────

describe('deleteProductImage cross-product guard', () => {
  it('throws 404 when expectedProductId does not match', async () => {
    vi.mocked(prisma.productImage.findUnique).mockResolvedValue({ productId: 'prod-1' } as never);
    await expect(adminProductService.deleteProductImage('img-1', 'prod-WRONG')).rejects.toThrow(
      HTTPException,
    );
    expect(prisma.productImage.delete).not.toHaveBeenCalled();
  });

  it('throws 404 when image does not exist (with expectedProductId)', async () => {
    vi.mocked(prisma.productImage.findUnique).mockResolvedValue(null);
    await expect(adminProductService.deleteProductImage('missing', 'prod-1')).rejects.toThrow(
      HTTPException,
    );
  });

  it('deletes when expectedProductId matches', async () => {
    vi.mocked(prisma.productImage.findUnique).mockResolvedValue({ productId: 'prod-1' } as never);
    vi.mocked(prisma.productImage.delete).mockResolvedValue(mockImage() as never);

    await expect(
      adminProductService.deleteProductImage('img-1', 'prod-1'),
    ).resolves.toBeUndefined();
    expect(prisma.productImage.delete).toHaveBeenCalledWith({ where: { id: 'img-1' } });
  });
});

// ─── reorderProductImages error handling ──────────────────────────────────────

describe('reorderProductImages error mapping', () => {
  it('translates P2025 (image of another product) into clean 404', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.$transaction).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      }),
    );

    await expect(
      adminProductService.reorderProductImages('prod-1', [{ id: 'img-other', sortOrder: 0 }]),
    ).rejects.toThrow(HTTPException);
  });
});
