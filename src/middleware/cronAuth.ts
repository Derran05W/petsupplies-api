import { timingSafeEqual } from 'crypto';
import { createMiddleware } from 'hono/factory';
import { env } from '../types/env.js';
import type { Variables } from '../types/hono.js';

function parseBearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export const cronAuth = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const raw = parseBearerToken(c.req.header('Authorization'));
  if (raw === null) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const expected = Buffer.from(env.CRON_BEARER_TOKEN, 'utf8');
  const received = Buffer.from(raw, 'utf8');

  if (received.length !== expected.length) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  if (!timingSafeEqual(received, expected)) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  await next();
});
