import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  addStockAlert,
  listStockAlerts,
  removeStockAlert,
} from '../services/stockAlertService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  sort: z.enum(['newest', 'oldest'] as const).optional(),
});

const productIdSchema = z.string().regex(/^c[a-z0-9]{24}$/, 'Invalid product id');

const postBodySchema = z
  .object({
    productId: productIdSchema,
  })
  .strict();

const productIdParamSchema = z.object({
  productId: productIdSchema,
});

router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const userId = c.get('userId');
  const result = await listStockAlerts({
    userId,
    page: q.page ?? 1,
    limit: q.limit ?? DEFAULT_LIMIT,
    sort: q.sort ?? 'newest',
  });
  return c.json(result);
});

router.post('/', zValidator('json', postBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const result = await addStockAlert({ userId, productId: body.productId });
  return result.created ? c.json(result.item, 201) : c.json(result.item, 200);
});

router.delete('/:productId', zValidator('param', productIdParamSchema), async (c) => {
  const userId = c.get('userId');
  const { productId } = c.req.valid('param');
  await removeStockAlert({ userId, productId });
  return c.body(null, 204);
});

export { router as stockAlertsRouter };
