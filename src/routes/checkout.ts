import { Hono } from 'hono';
import { auth } from '../middleware/auth.js';
import * as stripeService from '../services/stripeService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth);

router.post('/session', async (c) => {
  const userId = c.get('userId');
  const result = await stripeService.createCheckoutSessionFromCart(userId);
  return c.json(result, 200);
});

export { router as checkoutRouter };
