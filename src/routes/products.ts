import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ProductCategory } from '@prisma/client';
import * as productService from '../services/productService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

const listQuerySchema = z.object({
  category: z.nativeEnum(ProductCategory).optional(),
  q: z.string().optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  sort: z.enum(['price_asc', 'price_desc', 'newest', 'popularity']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const result = await productService.list(query);
  return c.json(result);
});

router.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const product = await productService.getBySlug(slug);
  if (!product) return c.json({ error: 'Product not found' }, 404);
  return c.json(product);
});

export { router as productsRouter };
