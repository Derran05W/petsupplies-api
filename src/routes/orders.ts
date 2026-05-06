import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import * as orderService from '../services/orderService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING', 'PAID', 'SHIPPED', 'FULFILLED', 'CANCELLED']).optional(),
});

router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const userId = c.get('userId');
  const { page, limit, status } = c.req.valid('query');
  const result = await orderService.listUserOrders(userId, { page, limit, status });
  return c.json(result);
});

router.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const order = await orderService.getUserOrder(userId, id);
  return c.json(order);
});

export { router as ordersRouter };
