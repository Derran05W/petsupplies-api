import { Hono } from 'hono';
import { cronAuth } from '../middleware/cronAuth.js';
import {
  type JobName,
  type JobResult,
  runAbandonedCartJob,
  runUpcomingDeliveryJob,
} from '../services/jobRunner.js';
import type { Variables } from '../types/hono.js';

const RUNNERS: Record<JobName, (now?: Date) => Promise<JobResult>> = {
  'abandoned-cart': runAbandonedCartJob,
  'upcoming-delivery': runUpcomingDeliveryJob,
};

export const jobsRouter = new Hono<{ Variables: Variables }>();

jobsRouter.post('/run/:name', cronAuth, async (c) => {
  const name = c.req.param('name') as string;
  const runner = RUNNERS[name as JobName];
  if (!runner) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  try {
    const result = await runner();
    return c.json(result, 200);
  } catch {
    console.error(
      JSON.stringify({
        op: 'jobs.run',
        evt: 'job_unhandled_error',
        name,
      }),
    );
    return c.json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
