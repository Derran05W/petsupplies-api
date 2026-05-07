import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { SubscriptionInterval, SubscriptionStatus } from '@prisma/client';
import { auth } from '../middleware/auth.js';
import * as subscriptionService from '../services/subscriptionService.js';
import type { Variables } from '../types/hono.js';

const CUID_REGEX = /^c[a-z0-9]{24}$/;

const intervalSchema = z.enum(['WEEK_2', 'WEEK_4', 'WEEK_8', 'WEEK_12'] as const);

const createSubscriptionBodySchema = z
  .object({
    productId: z.string().regex(CUID_REGEX, 'Invalid product id'),
    quantity: z.number().int().min(1).max(99),
    interval: intervalSchema,
    petId: z.string().regex(CUID_REGEX, 'Invalid pet id').optional(),
  })
  .strict();

export const subscriptionCheckoutRouter = new Hono<{ Variables: Variables }>();

subscriptionCheckoutRouter.use('*', auth);

subscriptionCheckoutRouter.post(
  '/',
  zValidator('json', createSubscriptionBodySchema),
  async (c) => {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const result = await subscriptionService.createSubscription(userId, {
      productId: body.productId,
      quantity: body.quantity,
      interval: body.interval as SubscriptionInterval,
      petId: body.petId,
    });
    return c.json(result, 200);
  },
);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional(),
});

const subscriptionIdParamSchema = z.object({
  id: z.string().regex(CUID_REGEX, 'Invalid subscription id'),
});

const updateSubscriptionSchema = z
  .object({
    quantity: z.number().int().min(1).max(99).optional(),
    interval: intervalSchema.optional(),
    petId: z.union([z.string().regex(CUID_REGEX, 'Invalid pet id'), z.null()]).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'EMPTY_PATCH' });

export const meSubscriptionsRouter = new Hono<{ Variables: Variables }>();

meSubscriptionsRouter.use('*', auth);

meSubscriptionsRouter.get('/', zValidator('query', listQuerySchema), async (c) => {
  const userId = c.get('userId');
  const q = c.req.valid('query');
  const result = await subscriptionService.listSubscriptions(userId, {
    page: q.page ?? 1,
    limit: q.limit ?? 20,
    ...(q.status ? { status: q.status as SubscriptionStatus } : {}),
  });
  return c.json(result);
});

meSubscriptionsRouter.get('/:id', zValidator('param', subscriptionIdParamSchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const row = await subscriptionService.getSubscription(userId, id);
  if (!row) {
    throw new HTTPException(404, { message: 'SUBSCRIPTION_NOT_FOUND' });
  }
  return c.json(row);
});

meSubscriptionsRouter.patch(
  '/:id',
  zValidator('param', subscriptionIdParamSchema),
  zValidator('json', updateSubscriptionSchema),
  async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = await subscriptionService.updateSubscription(userId, id, {
      quantity: body.quantity,
      interval: body.interval as SubscriptionInterval | undefined,
      petId: body.petId,
    });
    if (!row) {
      throw new HTTPException(404, { message: 'SUBSCRIPTION_NOT_FOUND' });
    }
    return c.json(row);
  },
);

meSubscriptionsRouter.post(
  '/:id/pause',
  zValidator('param', subscriptionIdParamSchema),
  async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const row = await subscriptionService.pauseSubscription(userId, id);
    if (!row) {
      throw new HTTPException(404, { message: 'SUBSCRIPTION_NOT_FOUND' });
    }
    return c.json(row);
  },
);

meSubscriptionsRouter.post(
  '/:id/resume',
  zValidator('param', subscriptionIdParamSchema),
  async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const row = await subscriptionService.resumeSubscription(userId, id);
    if (!row) {
      throw new HTTPException(404, { message: 'SUBSCRIPTION_NOT_FOUND' });
    }
    return c.json(row);
  },
);

meSubscriptionsRouter.delete('/:id', zValidator('param', subscriptionIdParamSchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const row = await subscriptionService.cancelSubscription(userId, id);
  if (!row) {
    throw new HTTPException(404, { message: 'SUBSCRIPTION_NOT_FOUND' });
  }
  return c.json(row);
});
