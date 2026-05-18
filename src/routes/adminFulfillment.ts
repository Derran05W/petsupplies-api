import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import * as fulfillmentService from '../services/fulfillmentService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

const fulfillmentQueueQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(['PENDING', 'PAID', 'SHIPPED', 'FULFILLED', 'CANCELLED']).optional(),
});

router.get('/queue', zValidator('query', fulfillmentQueueQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const rows = await fulfillmentService.listFulfillmentQueue({
    page: q.page,
    limit: q.limit,
    from: q.from,
    to: q.to,
    status: q.status,
  });
  return c.json(rows);
});

const bulkShipSchema = z.object({
  items: z
    .array(
      z.object({
        orderId: z.string().min(1),
        trackingNumber: z.string().min(1),
        carrier: z.string().min(1),
      }),
    )
    .min(1)
    .max(50),
});

router.post('/bulk-ship', zValidator('json', bulkShipSchema), async (c) => {
  const body = c.req.valid('json');
  const batch = await fulfillmentService.bulkShipOrders(body.items);
  return c.json(batch, 200);
});

export { router as adminFulfillmentRouter };
