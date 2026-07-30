import { Hono } from 'hono';
import { cronAuth } from '../middleware/cronAuth.js';
import {
  type JobName,
  type JobResult,
  runAbandonedCartJob,
  runBackInStockNotificationJob,
  runUpcomingDeliveryJob,
} from '../services/jobRunner.js';
import type { Variables } from '../types/hono.js';

const RUNNERS: Record<JobName, (now?: Date) => Promise<JobResult>> = {
  'abandoned-cart': runAbandonedCartJob,
  'upcoming-delivery': runUpcomingDeliveryJob,
  'back-in-stock': runBackInStockNotificationJob,
};

export const jobsRouter = new Hono<{ Variables: Variables }>();

jobsRouter.post('/run/:name', cronAuth, async (c) => {
  const name = c.req.param('name') as string;
  // Guard against prototype-chain lookups (e.g. `constructor`, `toString`) before indexing —
  // `RUNNERS[name]` alone would resolve inherited Object.prototype members for those names.
  if (!Object.hasOwn(RUNNERS, name)) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }
  const runner = RUNNERS[name as JobName];

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
