import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import * as userService from '../services/userService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth);

router.get('/me', async (c) => {
  const userId = c.get('userId');
  const user = await userService.getUser(userId);
  return c.json(user);
});

const updateUserSchema = z.object({
  name: z.string().trim().max(100).nullable().optional(),
});

router.patch('/me', zValidator('json', updateUserSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const user = await userService.updateUser(userId, body);
  return c.json(user);
});

export { router as usersRouter };
