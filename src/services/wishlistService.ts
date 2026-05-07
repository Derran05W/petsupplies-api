import { Prisma } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';

export type WishlistSortOption = 'newest' | 'oldest';

export type WishlistRejectReason = 'NOT_FOUND' | 'WISHLIST_FULL';

export interface WishlistProductImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface WishlistProductSnapshot {
  id: string;
  name: string;
  slug: string;
  price: number;
  active: boolean;
  images: WishlistProductImage[];
}

export interface WishlistItemResponse {
  id: string;
  addedAt: Date;
  product: WishlistProductSnapshot;
}

export interface PaginatedWishlist {
  data: WishlistItemResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AddToWishlistResult {
  item: WishlistItemResponse;
  created: boolean;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const MAX_WISHLIST_ITEMS_PER_USER = 500;

const wishlistSortMap: Record<WishlistSortOption, Prisma.WishlistItemOrderByWithRelationInput> = {
  newest: { addedAt: 'desc' },
  oldest: { addedAt: 'asc' },
};

const productSelect = {
  id: true,
  name: true,
  slug: true,
  price: true,
  active: true,
  images: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      url: true,
      altText: true,
      sortOrder: true,
      isPrimary: true,
    },
  },
} as const;

type WishlistWithProduct = Prisma.WishlistItemGetPayload<{
  include: { product: { select: typeof productSelect } };
}>;

function toWishlistItemResponse(row: WishlistWithProduct): WishlistItemResponse {
  return {
    id: row.id,
    addedAt: row.addedAt,
    product: {
      id: row.product.id,
      name: row.product.name,
      slug: row.product.slug,
      price: row.product.price,
      active: row.product.active,
      images: row.product.images.map((img) => ({
        id: img.id,
        url: img.url,
        altText: img.altText,
        sortOrder: img.sortOrder,
        isPrimary: img.isPrimary,
      })),
    },
  };
}

export async function listWishlist(input: {
  userId: string;
  page: number;
  limit: number;
  sort: WishlistSortOption;
}): Promise<PaginatedWishlist> {
  const page = Math.max(1, input.page <= 0 ? 1 : input.page);
  const rawLimit = input.limit <= 0 ? DEFAULT_LIMIT : input.limit;
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));
  const skip = (page - 1) * limit;
  const orderBy = wishlistSortMap[input.sort];

  const [rows, total] = await Promise.all([
    prisma.wishlistItem.findMany({
      where: { userId: input.userId },
      orderBy,
      skip,
      take: limit,
      include: { product: { select: productSelect } },
    }),
    prisma.wishlistItem.count({ where: { userId: input.userId } }),
  ]);

  return {
    data: rows.map(toWishlistItemResponse),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
  };
}

export async function addToWishlist(input: {
  userId: string;
  productId: string;
}): Promise<AddToWishlistResult> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true },
  });
  if (!product) {
    throw new HTTPException(404, { message: 'NOT_FOUND' });
  }

  const currentCount = await prisma.wishlistItem.count({ where: { userId: input.userId } });
  if (currentCount >= MAX_WISHLIST_ITEMS_PER_USER) {
    throw new HTTPException(400, { message: 'WISHLIST_FULL' });
  }

  try {
    const created = await prisma.wishlistItem.create({
      data: { userId: input.userId, productId: input.productId },
      include: { product: { select: productSelect } },
    });
    console.info(
      JSON.stringify({
        userId: input.userId,
        productId: input.productId,
        op: 'add',
      }),
    );
    return { item: toWishlistItemResponse(created), created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await prisma.wishlistItem.findUnique({
        where: { userId_productId: { userId: input.userId, productId: input.productId } },
        include: { product: { select: productSelect } },
      });
      if (!existing) {
        throw e;
      }
      console.info(
        JSON.stringify({
          userId: input.userId,
          productId: input.productId,
          op: 'add',
          reason: 'duplicate_noop',
        }),
      );
      return { item: toWishlistItemResponse(existing), created: false };
    }
    throw e;
  }
}

export async function removeFromWishlist(input: {
  userId: string;
  productId: string;
}): Promise<void> {
  await prisma.wishlistItem.deleteMany({
    where: { userId: input.userId, productId: input.productId },
  });
  console.info(
    JSON.stringify({
      userId: input.userId,
      productId: input.productId,
      op: 'remove',
    }),
  );
}
