import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Variables } from '../types/hono.js';

export interface RateLimitOptions {
  /** Max requests allowed per key within a single window. */
  limit: number;
  /** Fixed window size, in milliseconds. */
  windowMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

type RateLimitContext = Context<{ Variables: Variables }>;

function resolveKey(c: RateLimitContext): string {
  const userId = c.get('userId');
  if (userId) return `user:${userId}`;

  const forwardedFor = c.req.header('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0].trim();
    if (firstIp) return `ip:${firstIp}`;
  }

  return 'anonymous';
}

/**
 * Small in-memory fixed-window rate limiter, factory-style so each call site gets its own
 * independent counter store — mounting it on two different routes never shares buckets.
 *
 * Keys by the authenticated `userId` (set by the `auth` middleware — apply this middleware
 * AFTER `auth`), falling back to the first IP in `x-forwarded-for`, then a constant key for
 * fully-unauthenticated callers.
 *
 * On breach: responds 429 with a `Retry-After` header (seconds) and `{ error: 'RATE_LIMITED' }`.
 *
 * No-op whenever `NODE_ENV === 'test'` (checked per-request, before any counting) — the
 * integration suite fires many rapid requests at these routes and must not be throttled.
 * See tests/unit/rateLimit.test.ts for isolated coverage of the actual limiting behavior.
 *
 * TODO: replace with a shared store (Upstash/Railway Redis) — in-memory is per-instance, and
 * Railway runs multiple replicas.
 */
export function rateLimit({ limit, windowMs }: RateLimitOptions) {
  const windows = new Map<string, Window>();
  let lastPruneAt = Date.now();

  function pruneExpired(now: number): void {
    for (const [key, win] of windows) {
      if (win.resetAt <= now) windows.delete(key);
    }
    lastPruneAt = now;
  }

  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    if (process.env.NODE_ENV === 'test') {
      await next();
      return;
    }

    const now = Date.now();
    if (now - lastPruneAt > windowMs) {
      pruneExpired(now);
    }

    const key = resolveKey(c);
    let win = windows.get(key);
    if (!win || win.resetAt <= now) {
      win = { count: 0, resetAt: now + windowMs };
      windows.set(key, win);
    }
    win.count += 1;

    if (win.count > limit) {
      const retryAfterSec = Math.ceil((win.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfterSec));
      return c.json({ error: 'RATE_LIMITED' }, 429);
    }

    await next();
  });
}
