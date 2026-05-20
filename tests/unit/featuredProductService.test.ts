import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const tx = {
  featuredProduct: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
};

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    featuredProduct: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
  },
}));

vi.mock('../../src/services/revalidationService.js', () => ({
  revalidateFrontendTags: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma.js';
import * as featuredProductService from '../../src/services/featuredProductService.js';
import { revalidateFrontendTags } from '../../src/services/revalidationService.js';

const activeProduct = {
  id: 'prod-1',
  slug: 'dog-food',
  name: 'Dog Food',
  description: 'Good food',
  price: 999,
  stock: 10,
  active: true,
  category: 'DOG',
  imageUrl: null,
  images: [],
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
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('featuredProductService.replaceFeaturedProducts', () => {
  it('rejects more than 8 products', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `id-${i}`);
    await expect(featuredProductService.replaceFeaturedProducts(ids)).rejects.toBeInstanceOf(
      HTTPException,
    );
  });

  it('rejects inactive products', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 'prod-1', active: false, name: 'Inactive Item' },
    ] as never);

    await expect(featuredProductService.replaceFeaturedProducts(['prod-1'])).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Inactive products cannot be featured'),
    });
  });

  it('rejects unknown product IDs', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);

    await expect(
      featuredProductService.replaceFeaturedProducts(['missing-id']),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Unknown product ID'),
    });
  });

  it('replaces featured set atomically and revalidates', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 'prod-1', active: true, name: 'Dog Food' },
      { id: 'prod-2', active: true, name: 'Cat Food' },
    ] as never);
    vi.mocked(prisma.featuredProduct.findMany).mockResolvedValue([
      { product: activeProduct, position: 0 },
      {
        product: { ...activeProduct, id: 'prod-2', name: 'Cat Food' },
        position: 1,
      },
    ] as never);

    const result = await featuredProductService.replaceFeaturedProducts(['prod-1', 'prod-2']);

    expect(tx.featuredProduct.deleteMany).toHaveBeenCalled();
    expect(tx.featuredProduct.createMany).toHaveBeenCalledWith({
      data: [
        { productId: 'prod-1', position: 0 },
        { productId: 'prod-2', position: 1 },
      ],
    });
    expect(revalidateFrontendTags).toHaveBeenCalledWith(['site-featured']);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'prod-1', inStock: true });
  });
});

describe('featuredProductService.listFeaturedProducts', () => {
  it('filters inactive products and adds inStock', async () => {
    vi.mocked(prisma.featuredProduct.findMany).mockResolvedValue([
      { product: activeProduct, position: 0 },
      {
        product: { ...activeProduct, id: 'prod-2', active: false },
        position: 1,
      },
    ] as never);

    const result = await featuredProductService.listFeaturedProducts();
    expect(result).toHaveLength(1);
    expect(result[0].inStock).toBe(true);
  });
});
