import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ProductCategory } from '@prisma/client';
import { auth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import * as productService from '../services/productService.js';
import * as reviewService from '../services/reviewService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

const listQuerySchema = z.object({
  category: z.nativeEnum(ProductCategory).optional(),
  q: z.string().optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  sort: z
    .enum(['price_asc', 'price_desc', 'newest', 'popularity', 'rating_desc', 'rating_asc'])
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const createReviewBodySchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().min(1).max(2000),
    title: z.preprocess(
      (v) => (v === null || v === undefined || v === '' ? undefined : v),
      z.string().min(1).max(120).optional(),
    ),
  })
  .strict();

const reviewListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sort: z.enum(['newest', 'oldest', 'rating_desc', 'rating_asc']).optional(),
});

router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const result = await productService.list(query);
  return c.json(result);
});

router.post('/:slug/reviews', auth, zValidator('json', createReviewBodySchema), async (c) => {
  const slug = c.req.param('slug');
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const product = await prisma.product.findUnique({
    where: { slug },
    select: { id: true, active: true },
  });
  if (!product || !product.active) {
    return c.json({ error: 'Product not found' }, 404);
  }

  const review = await reviewService.createReview({
    productId: product.id,
    userId,
    rating: body.rating,
    title: body.title,
    body: body.body,
  });
  return c.json(review, 201);
});

router.get('/:slug/reviews', zValidator('query', reviewListQuerySchema), async (c) => {
  const slug = c.req.param('slug');
  const q = c.req.valid('query');
  const result = await reviewService.listReviewsByProductSlug({
    slug,
    page: q.page ?? 1,
    limit: q.limit ?? 20,
    sort: q.sort ?? 'newest',
  });
  return c.json(result);
});

router.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const product = await productService.getBySlug(slug);
  if (!product) return c.json({ error: 'Product not found' }, 404);
  return c.json(product);
});

export { router as productsRouter };
