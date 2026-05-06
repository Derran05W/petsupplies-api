import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { adminOnly } from '../middleware/adminOnly.js';
import * as orderService from '../services/orderService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth, adminOnly);

const adminListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING', 'PAID', 'SHIPPED', 'FULFILLED', 'CANCELLED']).optional(),
  userId: z.string().optional(),
  email: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get('/orders', zValidator('query', adminListQuerySchema), async (c) => {
  const { page, limit, status, userId, email, from, to } = c.req.valid('query');
  const result = await orderService.listAdminOrders({
    page,
    limit,
    status,
    userId,
    email,
    from,
    to,
  });
  return c.json(result);
});

router.get('/orders/:id', async (c) => {
  const id = c.req.param('id');
  const order = await orderService.getAdminOrder(id);
  return c.json(order);
});

const updateStatusSchema = z
  .object({
    status: z.enum(['CANCELLED', 'SHIPPED', 'FULFILLED']),
    trackingNumber: z.string().min(1).optional(),
    carrier: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'SHIPPED') {
      if (!data.trackingNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'trackingNumber is required when status is SHIPPED',
          path: ['trackingNumber'],
        });
      }
      if (!data.carrier) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'carrier is required when status is SHIPPED',
          path: ['carrier'],
        });
      }
    }
  });

router.patch('/orders/:id/status', zValidator('json', updateStatusSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const order = await orderService.updateAdminOrderStatus(id, body);
  return c.json(order);
});

export { router as adminRouter };
