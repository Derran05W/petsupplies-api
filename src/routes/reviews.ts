import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import * as reviewService from '../services/reviewService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth);

const updateReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    title: z.union([z.string().trim().min(1).max(120), z.null()]).optional(),
    body: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine((d) => d.rating !== undefined || d.title !== undefined || d.body !== undefined, {
    message: 'At least one field is required',
  });

router.patch('/:id', zValidator('json', updateReviewSchema), async (c) => {
  const reviewId = c.req.param('id');
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const review = await reviewService.updateReview(reviewId, userId, body);
  return c.json(review);
});

router.delete('/:id', async (c) => {
  const reviewId = c.req.param('id');
  const userId = c.get('userId');
  await reviewService.deleteReview(reviewId, userId);
  return c.body(null, 204);
});

export { router as reviewsRouter };
