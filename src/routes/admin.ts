import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { adminOnly } from '../middleware/adminOnly.js';
import * as orderService from '../services/orderService.js';
import * as discountService from '../services/discountService.js';
import { StripeCouponRejectedError } from '../services/discountService.js';
import * as subscriptionService from '../services/subscriptionService.js';
import * as fulfillmentService from '../services/fulfillmentService.js';
import type { Variables } from '../types/hono.js';
import { adminAnalyticsRouter } from './adminDashboard.js';
import { adminCustomersRouter } from './adminCustomers.js';
import { adminFulfillmentRouter } from './adminFulfillment.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth, adminOnly);

router.route('/analytics', adminAnalyticsRouter);
router.route('/customers', adminCustomersRouter);
router.route('/fulfillment', adminFulfillmentRouter);

const adminUpdateTrackingSchema = z.object({
  trackingNumber: z.string().min(1),
  carrier: z.string().min(1),
});

router.patch('/orders/:id/tracking', zValidator('json', adminUpdateTrackingSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const order = await fulfillmentService.updateOrderTracking(id, body);
  return c.json(order);
});

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

const createDiscountSchema = z
  .object({
    code: z
      .string()
      .min(3)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/),
    type: z.enum(['PERCENTAGE', 'FIXED', 'FREE_SHIPPING']),
    value: z.number().int(),
    minCartCents: z.number().int().nonnegative().nullable().optional(),
    maxRedemptions: z.number().int().positive().nullable().optional(),
    validFrom: z.coerce.date().nullable().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    active: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'PERCENTAGE' && (data.value < 1 || data.value > 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Percentage discount value must be between 1 and 100',
        path: ['value'],
      });
    }
    if (data.type === 'FIXED' && data.value < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Fixed discount amount must be at least 1 cent',
        path: ['value'],
      });
    }
    if (data.type === 'FREE_SHIPPING' && data.value !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FREE_SHIPPING discounts must have value 0',
        path: ['value'],
      });
    }
  });

const listDiscountsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  active: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
});

router.post('/discounts', zValidator('json', createDiscountSchema), async (c) => {
  const body = c.req.valid('json');
  try {
    const created = await discountService.createDiscount({
      code: body.code,
      type: body.type,
      value: body.value,
      minCartCents: body.minCartCents ?? undefined,
      maxRedemptions: body.maxRedemptions ?? undefined,
      validFrom: body.validFrom ?? undefined,
      validUntil: body.validUntil ?? undefined,
      active: body.active,
    });
    return c.json(created, 201);
  } catch (e) {
    if (e instanceof StripeCouponRejectedError) {
      return c.json(
        { error: 'Stripe rejected coupon creation', reason: 'STRIPE_COUPON_REJECTED' },
        400,
      );
    }
    throw e;
  }
});

router.get('/discounts', zValidator('query', listDiscountsQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const result = await discountService.listDiscounts({
    page: q.page,
    limit: q.limit,
    active: q.active,
  });
  return c.json(result);
});

const adminProductIdParamSchema = z.object({
  id: z.string().regex(/^c[a-z0-9]{24}$/, 'Invalid product id'),
});

const patchProductSubscriptionSchema = z
  .object({
    subscriptionEligible: z.boolean(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.subscriptionEligible === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'NOT_SUPPORTED',
        path: ['subscriptionEligible'],
      });
      return;
    }
    if (data.subscriptionEligible !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'subscriptionEligible must be true',
        path: ['subscriptionEligible'],
      });
    }
  });

router.patch(
  '/products/:id/subscription',
  zValidator('param', adminProductIdParamSchema),
  zValidator('json', patchProductSubscriptionSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await subscriptionService.markProductSubscriptionEligible(id);
    return c.json(result);
  },
);

export { router as adminRouter };
