import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './types/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { productsRouter } from './routes/products.js';
import { cartRouter } from './routes/cart.js';
import { checkoutRouter } from './routes/checkout.js';
import { webhooksRouter } from './routes/webhooks.js';
import type { Variables } from './types/hono.js';

export function createApp() {
  const app = new Hono<{ Variables: Variables }>();

  app.use(cors({ origin: env.FRONTEND_URL }));
  app.use(requestLogger);
  app.onError(errorHandler);

  // RAW BODY INVARIANT: /webhooks/stripe is mounted before any future JSON body-parser
  // middleware. Stripe signature verification requires the unparsed request body.
  // Do NOT move this mount point below any body-parsing middleware.
  app.route('/webhooks', webhooksRouter);

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/products', productsRouter);
  app.route('/cart', cartRouter);
  app.route('/checkout', checkoutRouter);

  return app;
}
