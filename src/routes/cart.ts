import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as cartService from '../services/cartService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth);

router.get('/', async (c) => {
  const userId = c.get('userId');
  const cart = await cartService.getCart(userId);
  return c.json(cart);
});

const addItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});
router.post('/items', zValidator('json', addItemSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const item = await cartService.addItem(userId, body);
  return c.json(item, 201);
});

const updateItemSchema = z.object({
  quantity: z.number().int().nonnegative(),
});
router.patch('/items/:id', zValidator('json', updateItemSchema), async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const { quantity } = c.req.valid('json');
  const item = await cartService.updateItem(userId, id, quantity);
  if (item === null) return c.body(null, 204);
  return c.json(item);
});

router.delete('/items/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await cartService.removeItem(userId, id);
  return c.body(null, 204);
});

const discountCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/),
});

// 10 requests/min per user — throttles discount-code guessing / rapid retry attempts.
router.post(
  '/discount',
  rateLimit({ limit: 10, windowMs: 60_000 }),
  zValidator('json', discountCodeSchema),
  async (c) => {
    const userId = c.get('userId');
    const { code } = c.req.valid('json');
    const result = await cartService.applyDiscount(userId, code);
    if (!result.ok) {
      const r = result.reason;
      if (r === 'INVALID_FORMAT') {
        return c.json({ error: 'Invalid discount code format', reason: r }, 400);
      }
      if (r === 'NOT_FOUND' || r === 'INACTIVE' || r === 'NOT_STARTED' || r === 'EXPIRED') {
        return c.json({ error: 'Discount code is not valid', reason: r }, 400);
      }
      if (r === 'MIN_CART_NOT_MET' || r === 'MAX_REDEMPTIONS_REACHED' || r === 'ALREADY_USED') {
        return c.json({ error: 'Discount cannot be applied to this cart', reason: r }, 409);
      }
      return c.json({ error: 'Discount code is not valid', reason: r }, 400);
    }
    return c.json(result.cart);
  },
);

router.delete('/discount', async (c) => {
  const userId = c.get('userId');
  const cart = await cartService.removeDiscount(userId);
  return c.json(cart);
});

router.delete('/', async (c) => {
  const userId = c.get('userId');
  await cartService.clear(userId);
  return c.body(null, 204);
});

export { router as cartRouter };
