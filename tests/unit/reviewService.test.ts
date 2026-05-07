import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    product: { findUnique: vi.fn() },
    review: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as reviewService from '../../src/services/reviewService.js';

const baseReview = {
  id: 'rev-1',
  productId: 'prod-1',
  userId: 'user-1',
  rating: 5,
  title: null as string | null,
  body: 'Great product',
  verified: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

type TxMock = {
  $queryRaw: ReturnType<typeof vi.fn>;
  product: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  orderItem: { findFirst: ReturnType<typeof vi.fn> };
  review: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
  };
};

function createTxMock(): TxMock {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'prod-1' }]),
    product: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    orderItem: { findFirst: vi.fn() },
    review: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
  };
}

function mockTransactionWith(tx: TxMock) {
  vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
    (cb as (t: TxMock) => unknown)(tx),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reviewService.createReview', () => {
  it('rejects POST when user has no PAID/SHIPPED/FULFILLED order containing the product', async () => {
    const tx = createTxMock();
    tx.product.findUnique.mockResolvedValue({ id: 'prod-1', active: true });
    tx.orderItem.findFirst.mockResolvedValue(null);
    mockTransactionWith(tx);

    await expect(
      reviewService.createReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 5,
        body: 'Nice',
      }),
    ).rejects.toMatchObject({ status: 403, message: 'PURCHASE_REQUIRED' });
  });

  it('accepts POST when user has a PAID order containing the product', async () => {
    const tx = createTxMock();
    tx.product.findUnique.mockResolvedValue({ id: 'prod-1', active: true });
    tx.orderItem.findFirst.mockResolvedValue({ id: 'oi-1' });
    tx.review.findUnique.mockResolvedValue(null);
    tx.review.create.mockResolvedValue({ ...baseReview });
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: 5 }, _count: { _all: 1 } });
    mockTransactionWith(tx);

    const r = await reviewService.createReview({
      productId: 'prod-1',
      userId: 'user-1',
      rating: 5,
      body: 'Nice',
    });
    expect(r.rating).toBe(5);
    expect(tx.orderItem.findFirst).toHaveBeenCalled();
  });

  it('accepts POST when user has a SHIPPED order containing the product', async () => {
    const tx = createTxMock();
    tx.product.findUnique.mockResolvedValue({ id: 'prod-1', active: true });
    tx.orderItem.findFirst.mockResolvedValue({ id: 'oi-1' });
    tx.review.findUnique.mockResolvedValue(null);
    tx.review.create.mockResolvedValue({ ...baseReview, rating: 4 });
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: 4 }, _count: { _all: 1 } });
    mockTransactionWith(tx);

    const r = await reviewService.createReview({
      productId: 'prod-1',
      userId: 'user-1',
      rating: 4,
      body: 'Shipped ok',
    });
    expect(r.rating).toBe(4);
  });

  it('accepts POST when user has a FULFILLED order containing the product', async () => {
    const tx = createTxMock();
    tx.product.findUnique.mockResolvedValue({ id: 'prod-1', active: true });
    tx.orderItem.findFirst.mockResolvedValue({ id: 'oi-1' });
    tx.review.findUnique.mockResolvedValue(null);
    tx.review.create.mockResolvedValue({ ...baseReview, rating: 3 });
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: 3 }, _count: { _all: 1 } });
    mockTransactionWith(tx);

    const r = await reviewService.createReview({
      productId: 'prod-1',
      userId: 'user-1',
      rating: 3,
      body: 'Fulfilled',
    });
    expect(r.rating).toBe(3);
  });

  it('rejects POST when user only has CANCELLED orders containing the product', async () => {
    const tx = createTxMock();
    tx.product.findUnique.mockResolvedValue({ id: 'prod-1', active: true });
    tx.orderItem.findFirst.mockResolvedValue(null);
    mockTransactionWith(tx);

    await expect(
      reviewService.createReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 5,
        body: 'x',
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: 'PURCHASE_REQUIRED',
    });
  });

  it('rejects POST when user only has PENDING orders containing the product', async () => {
    const tx = createTxMock();
    tx.product.findUnique.mockResolvedValue({ id: 'prod-1', active: true });
    tx.orderItem.findFirst.mockResolvedValue(null);
    mockTransactionWith(tx);

    await expect(
      reviewService.createReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 5,
        body: 'x',
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: 'PURCHASE_REQUIRED',
    });
  });

  it('snapshots verified=true on the created Review row', async () => {
    const tx = createTxMock();
    tx.product.findUnique.mockResolvedValue({ id: 'prod-1', active: true });
    tx.orderItem.findFirst.mockResolvedValue({ id: 'oi-1' });
    tx.review.findUnique.mockResolvedValue(null);
    tx.review.create.mockResolvedValue({ ...baseReview });
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: 5 }, _count: { _all: 1 } });
    mockTransactionWith(tx);

    await reviewService.createReview({
      productId: 'prod-1',
      userId: 'user-1',
      rating: 5,
      body: 'Hi',
    });

    expect(tx.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ verified: true }),
    });
  });

  it('rejects rating < 1', async () => {
    await expect(
      reviewService.createReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 0,
        body: 'x',
      }),
    ).rejects.toThrow(HTTPException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects rating > 5', async () => {
    await expect(
      reviewService.createReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 6,
        body: 'x',
      }),
    ).rejects.toThrow(HTTPException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects non-integer rating', async () => {
    await expect(
      reviewService.createReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 3.5,
        body: 'x',
      }),
    ).rejects.toThrow(HTTPException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects empty body after trim', async () => {
    await expect(
      reviewService.createReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 3,
        body: '   ',
      }),
    ).rejects.toThrow(HTTPException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects body longer than 2000 chars', async () => {
    await expect(
      reviewService.createReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 3,
        body: 'x'.repeat(2001),
      }),
    ).rejects.toThrow(HTTPException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts review without title', async () => {
    const tx = createTxMock();
    tx.product.findUnique.mockResolvedValue({ id: 'prod-1', active: true });
    tx.orderItem.findFirst.mockResolvedValue({ id: 'oi-1' });
    tx.review.findUnique.mockResolvedValue(null);
    tx.review.create.mockResolvedValue({ ...baseReview, title: null });
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: 5 }, _count: { _all: 1 } });
    mockTransactionWith(tx);

    await reviewService.createReview({
      productId: 'prod-1',
      userId: 'user-1',
      rating: 5,
      body: 'No title',
    });

    expect(tx.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: null }),
    });
  });

  it('rejects title longer than 120 chars', async () => {
    await expect(
      reviewService.createReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 5,
        body: 'ok',
        title: 't'.repeat(121),
      }),
    ).rejects.toThrow(HTTPException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns 409 ALREADY_REVIEWED on P2002 from concurrent duplicate POST', async () => {
    const tx = createTxMock();
    tx.product.findUnique.mockResolvedValue({ id: 'prod-1', active: true });
    tx.orderItem.findFirst.mockResolvedValue({ id: 'oi-1' });
    tx.review.findUnique.mockResolvedValue(null);
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    tx.review.create.mockRejectedValue(err);
    mockTransactionWith(tx);

    await expect(
      reviewService.createReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 5,
        body: 'x',
      }),
    ).rejects.toMatchObject({ status: 409, message: 'ALREADY_REVIEWED' });
  });

  it('returns 404 NOT_FOUND when product does not exist', async () => {
    const tx = createTxMock();
    tx.product.findUnique.mockResolvedValue(null);
    mockTransactionWith(tx);

    await expect(
      reviewService.createReview({
        productId: 'prod-missing',
        userId: 'user-1',
        rating: 5,
        body: 'x',
      }),
    ).rejects.toMatchObject({ status: 404, message: 'NOT_FOUND' });
  });

  it('createReview acquires Product FOR UPDATE before any write', async () => {
    const tx = createTxMock();
    const order: string[] = [];
    tx.$queryRaw.mockImplementation(async () => {
      order.push('lock');
      return [];
    });
    tx.product.findUnique.mockImplementation(async () => {
      order.push('product');
      return { id: 'prod-1', active: true };
    });
    tx.orderItem.findFirst.mockImplementation(async () => {
      order.push('purchase');
      return { id: 'oi-1' };
    });
    tx.review.findUnique.mockResolvedValue(null);
    tx.review.create.mockImplementation(async () => {
      order.push('create');
      return { ...baseReview };
    });
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: 5 }, _count: { _all: 1 } });
    mockTransactionWith(tx);

    await reviewService.createReview({
      productId: 'prod-1',
      userId: 'user-1',
      rating: 5,
      body: 'x',
    });

    expect(order).toEqual(['lock', 'product', 'purchase', 'create']);
  });
});

describe('reviewService.updateReview', () => {
  it('PATCH rejects when caller does not own the review (NOT_OWNER)', async () => {
    const tx = createTxMock();
    tx.review.findUnique.mockResolvedValue({
      ...baseReview,
      userId: 'other',
    });
    mockTransactionWith(tx);

    await expect(
      reviewService.updateReview('rev-1', 'user-1', { rating: 4 }),
    ).rejects.toMatchObject({ status: 403, message: 'NOT_OWNER' });
  });

  it('PATCH does not recompute verified field', async () => {
    const tx = createTxMock();
    tx.review.findUnique.mockResolvedValue({
      ...baseReview,
      userId: 'user-1',
      verified: true,
    });
    tx.review.update.mockResolvedValue({
      ...baseReview,
      userId: 'user-1',
      rating: 4,
      verified: true,
    });
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: 4 }, _count: { _all: 1 } });
    mockTransactionWith(tx);

    await reviewService.updateReview('rev-1', 'user-1', { rating: 4 });

    expect(tx.review.update).toHaveBeenCalledWith({
      where: { id: 'rev-1' },
      data: { rating: 4 },
    });
  });

  it('PATCH triggers recomputeProductAggregates inside the same transaction', async () => {
    const tx = createTxMock();
    tx.review.findUnique.mockResolvedValue({ ...baseReview, userId: 'user-1' });
    tx.review.update.mockResolvedValue({ ...baseReview, rating: 2 });
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: 2 }, _count: { _all: 1 } });
    mockTransactionWith(tx);

    await reviewService.updateReview('rev-1', 'user-1', { rating: 2 });

    expect(tx.review.aggregate).toHaveBeenCalledWith({
      where: { productId: 'prod-1' },
      _avg: { rating: true },
      _count: { _all: true },
    });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { avgRating: 2, reviewCount: 1 },
    });
  });
});

describe('reviewService.deleteReview', () => {
  it('DELETE rejects when caller does not own the review (NOT_OWNER)', async () => {
    const tx = createTxMock();
    tx.review.findUnique.mockResolvedValue({ ...baseReview, userId: 'other' });
    mockTransactionWith(tx);

    await expect(reviewService.deleteReview('rev-1', 'user-1')).rejects.toMatchObject({
      status: 403,
      message: 'NOT_OWNER',
    });
  });

  it('DELETE triggers recomputeProductAggregates inside the same transaction', async () => {
    const tx = createTxMock();
    tx.review.findUnique.mockResolvedValue({ ...baseReview, userId: 'user-1' });
    tx.review.delete.mockResolvedValue({ ...baseReview });
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { _all: 0 } });
    mockTransactionWith(tx);

    await reviewService.deleteReview('rev-1', 'user-1');

    expect(tx.review.delete).toHaveBeenCalledWith({ where: { id: 'rev-1' } });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { avgRating: null, reviewCount: 0 },
    });
  });

  it('DELETE returns 404 when review does not exist', async () => {
    const tx = createTxMock();
    tx.review.findUnique.mockResolvedValue(null);
    mockTransactionWith(tx);

    await expect(reviewService.deleteReview('rev-missing', 'user-1')).rejects.toMatchObject({
      status: 404,
      message: 'NOT_FOUND',
    });
  });
});

describe('reviewService.recomputeProductAggregates', () => {
  it('recomputeProductAggregates writes avgRating=null when reviewCount==0', async () => {
    const tx = createTxMock();
    tx.review.aggregate.mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    });

    await reviewService.recomputeProductAggregates('prod-1', tx as never);

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { avgRating: null, reviewCount: 0 },
    });
  });

  it('recomputeProductAggregates writes correct avg from aggregate', async () => {
    const tx = createTxMock();
    tx.review.aggregate.mockResolvedValue({
      _avg: { rating: 3.5 },
      _count: { _all: 2 },
    });

    await reviewService.recomputeProductAggregates('prod-1', tx as never);

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { avgRating: 3.5, reviewCount: 2 },
    });
  });

  it('recomputeProductAggregates is idempotent across repeated calls without intervening writes', async () => {
    const tx = createTxMock();
    tx.review.aggregate.mockResolvedValue({
      _avg: { rating: 4 },
      _count: { _all: 3 },
    });

    await reviewService.recomputeProductAggregates('prod-1', tx as never);
    await reviewService.recomputeProductAggregates('prod-1', tx as never);

    expect(tx.product.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'prod-1' },
      data: { avgRating: 4, reviewCount: 3 },
    });
    expect(tx.product.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'prod-1' },
      data: { avgRating: 4, reviewCount: 3 },
    });
  });
});
