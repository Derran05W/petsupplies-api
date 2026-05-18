import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import * as adminCustomerService from '../services/adminCustomerService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  email: z.string().optional(),
  role: z.enum(['CUSTOMER', 'ADMIN']).optional(),
});

router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const result = await adminCustomerService.listCustomers({
    page: q.page,
    limit: q.limit,
    email: q.email,
    role: q.role,
  });
  return c.json(result);
});

const userIdParams = z.object({
  id: z.string().min(1).max(128),
});

router.get('/:id', zValidator('param', userIdParams), async (c) => {
  const { id } = c.req.valid('param');
  const row = await adminCustomerService.getCustomerDetail(id);
  return c.json(row);
});

const customerOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING', 'PAID', 'SHIPPED', 'FULFILLED', 'CANCELLED']).optional(),
});

router.get(
  '/:id/orders',
  zValidator('param', userIdParams),
  zValidator('query', customerOrdersQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const q = c.req.valid('query');
    const orders = await adminCustomerService.listCustomerOrders(id, {
      page: q.page,
      limit: q.limit,
      status: q.status,
    });
    return c.json(orders);
  },
);

const subscriptionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional(),
});

router.get(
  '/:id/subscriptions',
  zValidator('param', userIdParams),
  zValidator('query', subscriptionsQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const q = c.req.valid('query');
    const result = await adminCustomerService.listCustomerSubscriptions(id, {
      page: q.page,
      limit: q.limit,
      status: q.status,
    });
    return c.json(result);
  },
);

export { router as adminCustomersRouter };
