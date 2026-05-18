import { ProductCategory, Prisma } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';

export type ProductSortOption =
  | 'price_asc'
  | 'price_desc'
  | 'newest'
  | 'popularity'
  | 'rating_desc'
  | 'rating_asc';

export interface ListParams {
  category?: ProductCategory;
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: ProductSortOption;
  page?: number;
  limit?: number;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const sortMap: Record<ProductSortOption, Prisma.ProductOrderByWithRelationInput> = {
  price_asc: { price: 'asc' },
  price_desc: { price: 'desc' },
  newest: { createdAt: 'desc' },
  popularity: { createdAt: 'desc' },
  rating_desc: { avgRating: { sort: 'desc', nulls: 'last' } },
  rating_asc: { avgRating: { sort: 'asc', nulls: 'last' } },
};

export async function list(params: ListParams) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  const where: Prisma.ProductWhereInput = { active: true };

  if (params.category) {
    where.category = params.category;
  }
  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    where.price = {};
    if (params.minPrice !== undefined) where.price.gte = params.minPrice;
    if (params.maxPrice !== undefined) where.price.lte = params.maxPrice;
  }

  if (params.q) {
    const query = params.q;

    // Full-text search: use raw SQL to filter by searchVector, then apply other filters
    const safeQuery = query.replace(/'/g, "''");
    const categoryClause = params.category ? `AND category = '${params.category}'` : '';
    const minPriceClause = params.minPrice !== undefined ? `AND price >= ${params.minPrice}` : '';
    const maxPriceClause = params.maxPrice !== undefined ? `AND price <= ${params.maxPrice}` : '';
    const orderClause = buildOrderClause(params.sort);

    const [rows, countRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Product"
         WHERE active = true
           AND "searchVector" @@ plainto_tsquery('english', '${safeQuery}')
           ${categoryClause} ${minPriceClause} ${maxPriceClause}
         ORDER BY ${orderClause}
         LIMIT ${limit} OFFSET ${skip}`,
      ),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "Product"
         WHERE active = true
           AND "searchVector" @@ plainto_tsquery('english', '${safeQuery}')
           ${categoryClause} ${minPriceClause} ${maxPriceClause}`,
      ),
    ]);

    const ids = rows.map((r) => r.id);
    const total = Number((countRows[0] as { count: bigint }).count);

    if (ids.length === 0) {
      return { products: [], total, page, limit };
    }

    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
      orderBy: sortMap[params.sort ?? 'newest'],
    });

    return {
      products: products.map(withInStock),
      total,
      page,
      limit,
    };
  }

  const orderBy = sortMap[params.sort ?? 'newest'];

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { images: { orderBy: { sortOrder: 'asc' } } },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products: products.map(withInStock),
    total,
    page,
    limit,
  };
}

export async function getBySlug(slug: string) {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: { images: { orderBy: { sortOrder: 'asc' } } },
  });

  if (!product || !product.active) return null;

  return withInStock(product);
}

export async function updateProductPackageMetadata(
  id: string,
  patch: {
    weightGrams?: number | null;
    lengthCm?: number | null;
    widthCm?: number | null;
    heightCm?: number | null;
    shipsSeparately?: boolean;
  },
) {
  try {
    return await prisma.product.update({
      where: { id },
      data: {
        ...(patch.weightGrams !== undefined ? { weightGrams: patch.weightGrams } : {}),
        ...(patch.lengthCm !== undefined ? { lengthCm: patch.lengthCm } : {}),
        ...(patch.widthCm !== undefined ? { widthCm: patch.widthCm } : {}),
        ...(patch.heightCm !== undefined ? { heightCm: patch.heightCm } : {}),
        ...(patch.shipsSeparately !== undefined ? { shipsSeparately: patch.shipsSeparately } : {}),
      },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new HTTPException(404, { message: 'Product not found' });
    }
    throw e;
  }
}

function withInStock<T extends { stock: number }>(product: T) {
  return { ...product, inStock: product.stock > 0 };
}

function buildOrderClause(sort?: ProductSortOption): string {
  switch (sort) {
    case 'price_asc':
      return 'price ASC';
    case 'price_desc':
      return 'price DESC';
    case 'rating_desc':
      return '"avgRating" DESC NULLS LAST';
    case 'rating_asc':
      return '"avgRating" ASC NULLS LAST';
    default:
      return '"createdAt" DESC';
  }
}
