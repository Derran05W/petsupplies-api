import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './types/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { productsRouter } from './routes/products.js';
import { cartRouter } from './routes/cart.js';
import type { Variables } from './types/hono.js';

export function createApp() {
  const app = new Hono<{ Variables: Variables }>();

  app.use(cors({ origin: env.FRONTEND_URL }));
  app.use(requestLogger);
  app.onError(errorHandler);

  // IMPORTANT: Register POST /webhooks/stripe here (before any JSON body parsing)
  // when implementing Phase 7. Stripe requires the raw request body for
  // signature verification. Hono doesn't auto-parse bodies, but keep this
  // seam clear by mounting the webhook route before any future body middleware.

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/products', productsRouter);
  app.route('/cart', cartRouter);

  return app;
}
