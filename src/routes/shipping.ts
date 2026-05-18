import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { auth } from '../middleware/auth.js';
import { shippingQuoteBodySchema } from '../schemas/shipping.js';
import * as shippingService from '../services/shippingService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth);

router.post('/quote', zValidator('json', shippingQuoteBodySchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const result = await shippingService.quoteForCart(userId, body);
  return c.json(result, 200);
});

export { router as shippingRouter };
