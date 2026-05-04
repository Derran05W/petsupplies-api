import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
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

router.delete('/', async (c) => {
  const userId = c.get('userId');
  await cartService.clear(userId);
  return c.body(null, 204);
});

export { router as cartRouter };
