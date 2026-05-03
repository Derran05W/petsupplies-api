import { createMiddleware } from 'hono/factory';

export const requestLogger = createMiddleware(async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(JSON.stringify({ method: c.req.method, path: c.req.path, status: c.res.status, ms }));
});
