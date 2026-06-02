import { Prisma } from '@prisma/client';
import type { Review } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';

export type ReviewSortOption = 'newest' | 'oldest' | 'rating_desc' | 'rating_asc';

export type ReviewRejectReason =
  | 'PURCHASE_REQUIRED'
  | 'ALREADY_REVIEWED'
  | 'NOT_OWNER'
  | 'NOT_FOUND';

export interface CreateReviewInput {
  productId: string;
  userId: string;
  rating: number;
  title?: string | null;
  body: string;
}

export interface UpdateReviewInput {
  rating?: number;
  title?: string | null;
  body?: string;
}

export interface ReviewAuthor {
  name: string | null;
  email: string;
}

export interface ReviewResponse {
  id: string;
  productId: string;
  userId: string;
  /** Public label from the reviewer account (name or email local-part). */
  displayName: string;
  rating: number;
  title: string | null;
  body: string;
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedReviews {
  data: ReviewResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const MAX_LIMIT = 100;

const ELIGIBLE_ORDER_STATUSES = ['PAID', 'SHIPPED', 'FULFILLED'] as const;

const reviewSortMap: Record<ReviewSortOption, Prisma.ReviewOrderByWithRelationInput> = {
  newest: { createdAt: 'desc' },
  oldest: { createdAt: 'asc' },
  rating_desc: { rating: 'desc' },
  rating_asc: { rating: 'asc' },
};

function firstNameFromLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) return 'Customer';
  const first = trimmed.split(/\s+/)[0] ?? trimmed;
  return first.length > 0 ? first : 'Customer';
}

export function reviewDisplayName(user: ReviewAuthor): string {
  const trimmed = user.name?.trim();
  if (trimmed && trimmed.length > 0) return firstNameFromLabel(trimmed);
  const local = user.email.split('@')[0]?.trim();
  return local && local.length > 0 ? firstNameFromLabel(local) : 'Customer';
}

type ReviewWithAuthor = Review & { user?: ReviewAuthor | null };

function toReviewResponse(r: ReviewWithAuthor): ReviewResponse {
  return {
    id: r.id,
    productId: r.productId,
    userId: r.userId,
    displayName: r.user ? reviewDisplayName(r.user) : 'Customer',
    rating: r.rating,
    title: r.title,
    body: r.body,
    verified: r.verified,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function validateCreateReviewInput(input: CreateReviewInput): void {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new HTTPException(400, { message: 'Invalid rating' });
  }
  const body = input.body.trim();
  if (body.length < 1 || body.length > 2000) {
    throw new HTTPException(400, { message: 'Invalid body' });
  }
  if (input.title != null) {
    const t = input.title.trim();
    if (t.length < 1 || t.length > 120) {
      throw new HTTPException(400, { message: 'Invalid title' });
    }
  }
}

function validateUpdateReviewInput(input: UpdateReviewInput): void {
  if (input.rating !== undefined) {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new HTTPException(400, { message: 'Invalid rating' });
    }
  }
  if (input.body !== undefined) {
    const b = input.body.trim();
    if (b.length < 1 || b.length > 2000) {
      throw new HTTPException(400, { message: 'Invalid body' });
    }
  }
  if (input.title !== undefined && input.title !== null) {
    const t = input.title.trim();
    if (t.length < 1 || t.length > 120) {
      throw new HTTPException(400, { message: 'Invalid title' });
    }
  }
}

export async function createReview(input: CreateReviewInput): Promise<ReviewResponse> {
  validateCreateReviewInput(input);
  const bodyTrimmed = input.body.trim();
  const titleValue = input.title == null || input.title.trim() === '' ? null : input.title.trim();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;

    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product || !product.active) {
      throw new HTTPException(404, { message: 'NOT_FOUND' });
    }

    const purchase = await tx.orderItem.findFirst({
      where: {
        productId: input.productId,
        order: {
          userId: input.userId,
          status: { in: [...ELIGIBLE_ORDER_STATUSES] },
        },
      },
      select: { id: true },
    });
    if (!purchase) {
      console.info(
        JSON.stringify({
          productId: input.productId,
          userId: input.userId,
          reason: 'PURCHASE_REQUIRED',
        }),
      );
      throw new HTTPException(403, { message: 'PURCHASE_REQUIRED' });
    }

    const duplicate = await tx.review.findUnique({
      where: { productId_userId: { productId: input.productId, userId: input.userId } },
    });
    if (duplicate) {
      throw new HTTPException(409, { message: 'ALREADY_REVIEWED' });
    }

    let review: Review;
    try {
      review = await tx.review.create({
        data: {
          productId: input.productId,
          userId: input.userId,
          rating: input.rating,
          title: titleValue,
          body: bodyTrimmed,
          verified: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        console.info(
          JSON.stringify({
            productId: input.productId,
            userId: input.userId,
            reason: 'duplicate_review_attempt',
          }),
        );
        throw new HTTPException(409, { message: 'ALREADY_REVIEWED' });
      }
      throw e;
    }

    await recomputeProductAggregates(input.productId, tx);

    console.info(
      JSON.stringify({
        reviewId: review.id,
        productId: input.productId,
        userId: input.userId,
        op: 'create',
      }),
    );

    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { name: true, email: true },
    });

    return toReviewResponse({ ...review, user: user ?? undefined });
  });
}

export async function listReviewsByProductSlug(input: {
  slug: string;
  page: number;
  limit: number;
  sort: ReviewSortOption;
}): Promise<PaginatedReviews> {
  const product = await prisma.product.findUnique({
    where: { slug: input.slug },
    select: { id: true, active: true },
  });
  if (!product || !product.active) {
    throw new HTTPException(404, { message: 'NOT_FOUND' });
  }

  const page = Math.max(1, input.page);
  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit));
  const skip = (page - 1) * limit;
  const sort = input.sort;

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where: { productId: product.id },
      orderBy: reviewSortMap[sort],
      skip,
      take: limit,
      include: {
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.review.count({ where: { productId: product.id } }),
  ]);

  return {
    data: reviews.map(toReviewResponse),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
  };
}

export async function updateReview(
  reviewId: string,
  userId: string,
  input: UpdateReviewInput,
): Promise<ReviewResponse> {
  validateUpdateReviewInput(input);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "Product"
      WHERE id = (SELECT "productId" FROM "Review" WHERE id = ${reviewId})
      FOR UPDATE
    `;

    const existing = await tx.review.findUnique({ where: { id: reviewId } });
    if (!existing) {
      throw new HTTPException(404, { message: 'NOT_FOUND' });
    }
    if (existing.userId !== userId) {
      throw new HTTPException(403, { message: 'NOT_OWNER' });
    }

    const data: Prisma.ReviewUpdateInput = {};
    if (input.rating !== undefined) data.rating = input.rating;
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) data.body = input.body.trim();

    const review = await tx.review.update({
      where: { id: reviewId },
      data,
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    await recomputeProductAggregates(existing.productId, tx);

    console.info(
      JSON.stringify({
        reviewId,
        productId: existing.productId,
        userId,
        op: 'update',
      }),
    );

    return toReviewResponse(review);
  });
}

export async function deleteReview(reviewId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "Product"
      WHERE id = (SELECT "productId" FROM "Review" WHERE id = ${reviewId})
      FOR UPDATE
    `;

    const existing = await tx.review.findUnique({ where: { id: reviewId } });
    if (!existing) {
      throw new HTTPException(404, { message: 'NOT_FOUND' });
    }
    if (existing.userId !== userId) {
      throw new HTTPException(403, { message: 'NOT_OWNER' });
    }

    await tx.review.delete({ where: { id: reviewId } });
    await recomputeProductAggregates(existing.productId, tx);

    console.info(
      JSON.stringify({
        reviewId,
        productId: existing.productId,
        userId,
        op: 'delete',
      }),
    );
  });
}

/** Recompute Product.avgRating + Product.reviewCount for the given product within a transaction.
 *  Caller MUST already hold a row lock on the Product (SELECT … FOR UPDATE). */
export async function recomputeProductAggregates(
  productId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const agg = await tx.review.aggregate({
    where: { productId },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const reviewCount = agg._count._all;
  const avgRating = reviewCount === 0 ? null : agg._avg.rating;
  await tx.product.update({
    where: { id: productId },
    data: { avgRating, reviewCount },
  });
}
