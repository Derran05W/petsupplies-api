import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import * as adminDashboardService from '../services/adminDashboardService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

const overviewQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const revenueTimeseriesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  granularity: z.enum(['day', 'week']).default('day'),
});

const topProductsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

const lowStockQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  threshold: z.coerce.number().int().nonnegative().max(100).optional(),
});

router.get('/overview', zValidator('query', overviewQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const overview = await adminDashboardService.getOverview(q.from, q.to);
  return c.json(overview);
});

router.get('/revenue-timeseries', zValidator('query', revenueTimeseriesQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const result = await adminDashboardService.getRevenueTimeseries(q.from, q.to, q.granularity);
  return c.json(result);
});

router.get('/products/top', zValidator('query', topProductsQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const result = await adminDashboardService.getTopProducts(q.from, q.to, q.limit);
  return c.json(result);
});

router.get('/products/low-stock', zValidator('query', lowStockQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const result = await adminDashboardService.getLowStockProducts({
    page: q.page,
    limit: q.limit,
    threshold: q.threshold,
  });
  return c.json(result);
});

router.get('/subscriptions', async (c) => {
  const result = await adminDashboardService.getSubscriptionStats();
  return c.json(result);
});

router.get('/discounts', zValidator('query', overviewQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const result = await adminDashboardService.getDiscountStats(q.from, q.to);
  return c.json(result);
});

export { router as adminAnalyticsRouter };
