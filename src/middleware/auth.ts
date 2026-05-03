import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import type { Variables } from '../types/hono.js';

export const auth = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);

  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    const sub = payload.sub;
    if (typeof sub !== 'string' || !sub) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    c.set('userId', sub);
    await next();
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }
});
