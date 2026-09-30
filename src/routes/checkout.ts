import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { auth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { checkoutSessionBodySchema } from '../schemas/shipping.js';
import * as stripeService from '../services/stripeService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth);

// 10 requests/min per user — creates a Stripe Checkout Session + a PENDING order per call.
router.post(
  '/session',
  rateLimit({ limit: 10, windowMs: 60_000 }),
  zValidator('json', checkoutSessionBodySchema),
  async (c) => {
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const result = await stripeService.createCheckoutSessionFromCart(
      userId,
      body.shippingSelection,
    );
    return c.json(result, 200);
  },
);

export { router as checkoutRouter };
