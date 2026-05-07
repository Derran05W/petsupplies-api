import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    product: { findUnique: vi.fn() },
    wishlistItem: {
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as wishlistService from '../../src/services/wishlistService.js';

const baseProductEmbed = {
  id: 'prod-1',
  name: 'Pet Food',
  slug: 'pet-food',
  price: 2499,
  active: true,
  images: [
    {
      id: 'img-1',
      url: 'https://example.com/1.jpg',
      altText: 'front',
      sortOrder: 0,
      isPrimary: true,
    },
    {
      id: 'img-2',
      url: 'https://example.com/2.jpg',
      altText: null,
      sortOrder: 1,
      isPrimary: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wishlistService.addToWishlist', () => {
  const row = {
    id: 'wli-1',
    userId: 'user-1',
    productId: 'prod-1',
    addedAt: new Date('2026-01-05T12:00:00.000Z'),
    product: { ...baseProductEmbed },
  };

  it('creates a new wishlist item and returns created=true', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(0);
    vi.mocked(prisma.wishlistItem.create).mockResolvedValue(row as never);

    const result = await wishlistService.addToWishlist({ userId: 'user-1', productId: 'prod-1' });
    expect(result.created).toBe(true);
    expect(result.item.id).toBe('wli-1');
    expect(result.item.product.price).toBe(2499);
    expect(prisma.wishlistItem.create).toHaveBeenCalled();
  });

  it('returns existing item with created=false when create throws P2002', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(0);
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    vi.mocked(prisma.wishlistItem.create).mockRejectedValue(err);
    vi.mocked(prisma.wishlistItem.findUnique).mockResolvedValue(row as never);

    const result = await wishlistService.addToWishlist({ userId: 'user-1', productId: 'prod-1' });
    expect(result.created).toBe(false);
    expect(result.item.id).toBe('wli-1');
  });

  it('leaves addedAt unchanged on P2002 re-add', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(0);
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    vi.mocked(prisma.wishlistItem.create).mockRejectedValue(err);
    const unchanged = new Date('2026-03-03T03:03:03.003Z');
    vi.mocked(prisma.wishlistItem.findUnique).mockResolvedValue({
      ...row,
      addedAt: unchanged,
    } as never);

    const result = await wishlistService.addToWishlist({ userId: 'user-1', productId: 'prod-1' });
    expect(result.item.addedAt).toEqual(unchanged);
  });

  it('returns 404 NOT_FOUND when product is missing', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

    await expect(
      wishlistService.addToWishlist({ userId: 'user-1', productId: 'missing' }),
    ).rejects.toMatchObject({ status: 404, message: 'NOT_FOUND' });
    expect(prisma.wishlistItem.count).not.toHaveBeenCalled();
  });

  it('allows inactive products when the product exists', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(0);
    vi.mocked(prisma.wishlistItem.create).mockResolvedValue({
      ...row,
      product: { ...baseProductEmbed, active: false },
    } as never);

    const result = await wishlistService.addToWishlist({ userId: 'user-1', productId: 'prod-1' });
    expect(result.item.product.active).toBe(false);
  });

  it('returns 400 WISHLIST_FULL when user already has 500 items', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(500);

    await expect(
      wishlistService.addToWishlist({ userId: 'user-1', productId: 'prod-1' }),
    ).rejects.toMatchObject({ status: 400, message: 'WISHLIST_FULL' });
    expect(prisma.wishlistItem.create).not.toHaveBeenCalled();
  });

  it('checks capacity before insert', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(500);

    await expect(
      wishlistService.addToWishlist({ userId: 'user-1', productId: 'prod-1' }),
    ).rejects.toThrow(HTTPException);
    expect(prisma.wishlistItem.count).toHaveBeenCalled();
    expect(prisma.wishlistItem.create).not.toHaveBeenCalled();
  });

  it('logs userId, productId, and op=add only', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(0);
    vi.mocked(prisma.wishlistItem.create).mockResolvedValue(row as never);

    await wishlistService.addToWishlist({ userId: 'user-1', productId: 'prod-1' });
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(payload).toEqual({ userId: 'user-1', productId: 'prod-1', op: 'add' });
  });

  it('rethrows P2002 when findUnique cannot load the existing row', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: 'prod-1' } as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(0);
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    vi.mocked(prisma.wishlistItem.create).mockRejectedValue(err);
    vi.mocked(prisma.wishlistItem.findUnique).mockResolvedValue(null);

    await expect(
      wishlistService.addToWishlist({ userId: 'user-1', productId: 'prod-1' }),
    ).rejects.toThrow(err);
  });
});

describe('wishlistService.listWishlist', () => {
  const listRow = {
    id: 'wli-1',
    userId: 'user-1',
    productId: 'prod-1',
    addedAt: new Date('2026-01-01T00:00:00.000Z'),
    product: { ...baseProductEmbed, price: 1299 },
  };

  it('returns default page=1 limit=20 sort=newest', async () => {
    vi.mocked(prisma.wishlistItem.findMany).mockResolvedValue([listRow] as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(1);

    const result = await wishlistService.listWishlist({
      userId: 'user-1',
      page: 1,
      limit: 20,
      sort: 'newest',
    });

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        orderBy: { addedAt: 'desc' },
        skip: 0,
        take: 20,
      }),
    );
  });

  it('clamps limit to 100', async () => {
    vi.mocked(prisma.wishlistItem.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(0);

    await wishlistService.listWishlist({
      userId: 'user-1',
      page: 1,
      limit: 500,
      sort: 'newest',
    });

    expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it('supports sort=oldest', async () => {
    vi.mocked(prisma.wishlistItem.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(0);

    await wishlistService.listWishlist({
      userId: 'user-1',
      page: 1,
      limit: 20,
      sort: 'oldest',
    });

    expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { addedAt: 'asc' } }),
    );
  });

  it('exposes product.price (Int cents) matching cartService shape', async () => {
    vi.mocked(prisma.wishlistItem.findMany).mockResolvedValue([listRow] as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(1);

    const result = await wishlistService.listWishlist({
      userId: 'user-1',
      page: 1,
      limit: 20,
      sort: 'newest',
    });
    expect(result.data[0].product.price).toBe(1299);
    expect(Number.isInteger(result.data[0].product.price)).toBe(true);
  });

  it('includes product images ordered by sortOrder', async () => {
    vi.mocked(prisma.wishlistItem.findMany).mockResolvedValue([listRow] as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(1);

    const result = await wishlistService.listWishlist({
      userId: 'user-1',
      page: 1,
      limit: 20,
      sort: 'newest',
    });
    expect(result.data[0].product.images.map((i) => i.sortOrder)).toEqual([0, 1]);
  });

  it('includes inactive products with active=false', async () => {
    const inactiveRow = {
      ...listRow,
      product: { ...baseProductEmbed, active: false },
    };
    vi.mocked(prisma.wishlistItem.findMany).mockResolvedValue([inactiveRow] as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(1);

    const result = await wishlistService.listWishlist({
      userId: 'user-1',
      page: 1,
      limit: 20,
      sort: 'newest',
    });
    expect(result.data[0].product.active).toBe(false);
  });

  it('scopes findMany and count by userId', async () => {
    vi.mocked(prisma.wishlistItem.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(0);

    await wishlistService.listWishlist({
      userId: 'user-b',
      page: 2,
      limit: 10,
      sort: 'newest',
    });

    expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-b' } }),
    );
    expect(prisma.wishlistItem.count).toHaveBeenCalledWith({ where: { userId: 'user-b' } });
  });

  it('does not leak another user wishlist items', async () => {
    vi.mocked(prisma.wishlistItem.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.wishlistItem.count).mockResolvedValue(0);

    await wishlistService.listWishlist({
      userId: 'user-isolated',
      page: 1,
      limit: 20,
      sort: 'newest',
    });

    const call = vi.mocked(prisma.wishlistItem.findMany).mock.calls[0][0] as {
      where: { userId: string };
    };
    expect(call.where.userId).toBe('user-isolated');
    expect(call.where).not.toHaveProperty('productId');
  });
});

describe('wishlistService.removeFromWishlist', () => {
  it('calls deleteMany with userId and productId', async () => {
    vi.mocked(prisma.wishlistItem.deleteMany).mockResolvedValue({ count: 1 });
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await wishlistService.removeFromWishlist({ userId: 'user-1', productId: 'prod-1' });

    expect(prisma.wishlistItem.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', productId: 'prod-1' },
    });
    expect(spy).toHaveBeenCalled();
  });

  it('treats deleteMany count=1 as success', async () => {
    vi.mocked(prisma.wishlistItem.deleteMany).mockResolvedValue({ count: 1 });
    vi.spyOn(console, 'info').mockImplementation(() => {});

    await expect(
      wishlistService.removeFromWishlist({ userId: 'user-1', productId: 'prod-1' }),
    ).resolves.toBeUndefined();
  });

  it('treats deleteMany count=0 as success', async () => {
    vi.mocked(prisma.wishlistItem.deleteMany).mockResolvedValue({ count: 0 });
    vi.spyOn(console, 'info').mockImplementation(() => {});

    await expect(
      wishlistService.removeFromWishlist({ userId: 'user-1', productId: 'prod-x' }),
    ).resolves.toBeUndefined();
  });

  it('cannot affect another user because userId is in the where predicate', async () => {
    vi.mocked(prisma.wishlistItem.deleteMany).mockResolvedValue({ count: 0 });
    vi.spyOn(console, 'info').mockImplementation(() => {});

    await wishlistService.removeFromWishlist({ userId: 'user-a', productId: 'prod-1' });

    expect(prisma.wishlistItem.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-a', productId: 'prod-1' },
    });
  });

  it('logs userId, productId, and op=remove only', async () => {
    vi.mocked(prisma.wishlistItem.deleteMany).mockResolvedValue({ count: 1 });
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await wishlistService.removeFromWishlist({ userId: 'user-1', productId: 'prod-1' });

    const payload = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(payload).toEqual({ userId: 'user-1', productId: 'prod-1', op: 'remove' });
  });
});
