import { ProductCategory, Prisma } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ListAdminProductsParams {
  page?: number;
  limit?: number;
  q?: string;
  category?: ProductCategory;
  active?: boolean;
}

export interface CreateProductInput {
  name: string;
  slug?: string;
  description: string;
  price: number;
  stock?: number;
  category?: ProductCategory;
  categories?: ProductCategory[];
  active?: boolean;
  ingredients?: string | null;
  imageUrl?: string | null;
  tags?: string[];
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  shipsSeparately?: boolean;
}

export type UpdateProductInput = Partial<CreateProductInput>;

export interface AddProductImageInput {
  url: string;
  altText?: string | null;
  sortOrder?: number;
  isPrimary?: boolean;
}

export interface UpdateProductImageInput {
  url?: string;
  altText?: string | null;
  sortOrder?: number;
  isPrimary?: boolean;
}

export interface ReorderItem {
  id: string;
  sortOrder: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/** Dedupe a category list preserving first-seen order. */
function dedupeCategories(categories: ProductCategory[]): ProductCategory[] {
  return [...new Set(categories)];
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
  return slug || 'product';
}

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let attempt = 0;
  while (true) {
    const existing = await prisma.product.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) return candidate;
    attempt++;
    candidate = `${base}-${attempt}`;
  }
}

// ─── Product CRUD ─────────────────────────────────────────────────────────────

export async function listAdminProducts(params: ListAdminProductsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  const where: Prisma.ProductWhereInput = {};

  if (params.active !== undefined) {
    where.active = params.active;
  }
  if (params.category) {
    where.categories = { has: params.category };
  }
  if (params.q) {
    const q = params.q.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { images: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return { products, total, page, limit };
}

export async function getAdminProductById(id: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { images: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!product) {
    throw new HTTPException(404, { message: 'Product not found' });
  }
  return product;
}

export async function createProduct(input: CreateProductInput) {
  const baseSlug = input.slug ?? slugify(input.name);
  const slug = await ensureUniqueSlug(baseSlug);

  const resolvedCategories = dedupeCategories(
    input.categories ?? (input.category !== undefined ? [input.category] : []),
  );
  const primaryCategory = resolvedCategories[0];

  try {
    return await prisma.product.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        price: input.price,
        stock: input.stock ?? 0,
        category: primaryCategory,
        categories: resolvedCategories,
        active: input.active ?? true,
        ingredients: input.ingredients ?? null,
        imageUrl: input.imageUrl ?? null,
        tags: input.tags ?? [],
        weightGrams: input.weightGrams ?? null,
        lengthCm: input.lengthCm ?? null,
        widthCm: input.widthCm ?? null,
        heightCm: input.heightCm ?? null,
        shipsSeparately: input.shipsSeparately ?? false,
      },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new HTTPException(409, { message: `Slug "${slug}" already exists` });
    }
    throw e;
  }
}

export async function updateProduct(id: string, patch: UpdateProductInput) {
  // If slug is being changed, check uniqueness first
  if (patch.slug !== undefined) {
    const conflict = await prisma.product.findUnique({
      where: { slug: patch.slug },
      select: { id: true },
    });
    if (conflict && conflict.id !== id) {
      throw new HTTPException(409, { message: `Slug "${patch.slug}" already exists` });
    }
  }

  const data: Prisma.ProductUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.slug !== undefined) data.slug = patch.slug;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.price !== undefined) data.price = patch.price;
  if (patch.stock !== undefined) data.stock = patch.stock;
  // Keep `category` (back-compat scalar) and `categories` (authoritative list)
  // consistent in every path: category always equals categories[0].
  if (patch.categories !== undefined) {
    const categories = dedupeCategories(patch.categories);
    data.categories = categories;
    data.category = categories[0];
  } else if (patch.category !== undefined) {
    data.category = patch.category;
    data.categories = [patch.category];
  }
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.ingredients !== undefined) data.ingredients = patch.ingredients;
  if (patch.imageUrl !== undefined) data.imageUrl = patch.imageUrl;
  if (patch.tags !== undefined) data.tags = patch.tags;
  if (patch.weightGrams !== undefined) data.weightGrams = patch.weightGrams;
  if (patch.lengthCm !== undefined) data.lengthCm = patch.lengthCm;
  if (patch.widthCm !== undefined) data.widthCm = patch.widthCm;
  if (patch.heightCm !== undefined) data.heightCm = patch.heightCm;
  if (patch.shipsSeparately !== undefined) data.shipsSeparately = patch.shipsSeparately;

  try {
    return await prisma.product.update({
      where: { id },
      data,
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new HTTPException(404, { message: 'Product not found' });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const label = patch.slug ?? '(unknown)';
      throw new HTTPException(409, { message: `Slug "${label}" already exists` });
    }
    throw e;
  }
}

export async function deleteProduct(id: string): Promise<{ deleted: 'soft' | 'hard' }> {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!product) {
    throw new HTTPException(404, { message: 'Product not found' });
  }

  const [orderItemCount, subscriptionCount] = await Promise.all([
    prisma.orderItem.count({ where: { productId: id } }),
    prisma.subscription.count({ where: { productId: id } }),
  ]);

  if (orderItemCount > 0 || subscriptionCount > 0) {
    // Soft delete — preserve order history
    await prisma.product.update({
      where: { id },
      data: { active: false },
    });
    return { deleted: 'soft' };
  }

  // Hard delete — cascades via Prisma relations
  await prisma.product.delete({ where: { id } });
  return { deleted: 'hard' };
}

// ─── Product Image Management ─────────────────────────────────────────────────

export async function addProductImage(productId: string, input: AddProductImageInput) {
  // Verify product exists
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    throw new HTTPException(404, { message: 'Product not found' });
  }

  if (input.isPrimary) {
    return prisma.$transaction(async (tx) => {
      await tx.productImage.updateMany({
        where: { productId, isPrimary: true },
        data: { isPrimary: false },
      });
      return tx.productImage.create({
        data: {
          productId,
          url: input.url,
          altText: input.altText ?? null,
          sortOrder: input.sortOrder ?? 0,
          isPrimary: true,
        },
      });
    });
  }

  return prisma.productImage.create({
    data: {
      productId,
      url: input.url,
      altText: input.altText ?? null,
      sortOrder: input.sortOrder ?? 0,
      isPrimary: false,
    },
  });
}

export async function updateProductImage(
  imageId: string,
  patch: UpdateProductImageInput,
  expectedProductId?: string,
) {
  const existing = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { id: true, productId: true },
  });
  if (!existing) {
    throw new HTTPException(404, { message: 'Image not found' });
  }
  if (expectedProductId !== undefined && existing.productId !== expectedProductId) {
    throw new HTTPException(404, {
      message: 'Image not found on this product',
    });
  }

  const data: Prisma.ProductImageUpdateInput = {};
  if (patch.url !== undefined) data.url = patch.url;
  if (patch.altText !== undefined) data.altText = patch.altText;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;

  if (patch.isPrimary === true) {
    return prisma.$transaction(async (tx) => {
      await tx.productImage.updateMany({
        where: { productId: existing.productId, isPrimary: true },
        data: { isPrimary: false },
      });
      return tx.productImage.update({
        where: { id: imageId },
        data: { ...data, isPrimary: true },
      });
    });
  }

  return prisma.productImage.update({
    where: { id: imageId },
    data: { ...data, ...(patch.isPrimary === false ? { isPrimary: false } : {}) },
  });
}

export async function deleteProductImage(
  imageId: string,
  expectedProductId?: string,
): Promise<void> {
  if (expectedProductId !== undefined) {
    const existing = await prisma.productImage.findUnique({
      where: { id: imageId },
      select: { productId: true },
    });
    if (!existing) {
      throw new HTTPException(404, { message: 'Image not found' });
    }
    if (existing.productId !== expectedProductId) {
      throw new HTTPException(404, { message: 'Image not found on this product' });
    }
  }
  try {
    await prisma.productImage.delete({ where: { id: imageId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new HTTPException(404, { message: 'Image not found' });
    }
    throw e;
  }
}

export async function reorderProductImages(productId: string, items: ReorderItem[]): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    throw new HTTPException(404, { message: 'Product not found' });
  }

  try {
    await prisma.$transaction(
      items.map((item) =>
        prisma.productImage.update({
          where: { id: item.id, productId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new HTTPException(404, {
        message: 'One or more images not found on this product',
      });
    }
    throw e;
  }
}
