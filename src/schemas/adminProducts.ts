import { z } from 'zod';
import { ProductCategory } from '@prisma/client';

// ─── Product schemas ──────────────────────────────────────────────────────────

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens')
      .min(1)
      .max(200)
      .optional(),
    description: z.string().trim().min(1).max(10_000),
    price: z.number().int().positive({ message: 'Price must be a positive integer (cents)' }),
    stock: z.number().int().nonnegative().default(0),
    category: z.nativeEnum(ProductCategory),
    active: z.boolean().default(true),
    imageUrl: z.string().url().nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
    weightGrams: z.number().int().min(1).max(50_000).nullable().optional(),
    lengthCm: z.number().int().min(1).max(200).nullable().optional(),
    widthCm: z.number().int().min(1).max(200).nullable().optional(),
    heightCm: z.number().int().min(1).max(200).nullable().optional(),
    shipsSeparately: z.boolean().optional(),
  })
  .strict();

export const updateProductSchema = createProductSchema.partial();

// ─── Image schemas ────────────────────────────────────────────────────────────

export const addImageSchema = z
  .object({
    url: z.string().url(),
    altText: z.string().trim().max(255).nullable().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const updateImageSchema = z
  .object({
    url: z.string().url().optional(),
    altText: z.string().trim().max(255).nullable().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

export const reorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        sortOrder: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(50),
});

// ─── Upload URL schema ────────────────────────────────────────────────────────

export const uploadUrlRequestSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  })
  .strict();

// ─── Query schemas ────────────────────────────────────────────────────────────

export const listAdminProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().optional(),
  category: z.nativeEnum(ProductCategory).optional(),
  active: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
});

export const productIdParamSchema = z.object({
  id: z.string().min(1),
});

export const imageIdParamSchema = z.object({
  id: z.string().min(1),
  imageId: z.string().min(1),
});
