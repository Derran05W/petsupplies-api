import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { rateLimit } from '../../src/middleware/rateLimit.js';
import type { Variables } from '../../src/types/hono.js';

// The middleware no-ops when NODE_ENV === 'test' (tests/setup.ts sets this for the whole
// suite) so the wider integration suite's rapid-fire requests are never throttled. To
// exercise the real limiting logic here, temporarily set NODE_ENV to something else for the
// duration of each test, then restore it.
const ORIGINAL_NODE_ENV = process.env.NODE_ENV ?? 'test';

function appWithFixedUser(opts: { limit: number; windowMs: number }, userId: string) {
  const app = new Hono<{ Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    await next();
  });
  app.get('/ping', rateLimit(opts), (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    vi.useRealTimers();
  });

  it('is a no-op when NODE_ENV is "test" (integration-suite safety gate)', async () => {
    process.env.NODE_ENV = 'test';
    const app = appWithFixedUser({ limit: 1, windowMs: 60_000 }, 'user-1');

    const first = await app.request('/ping');
    const second = await app.request('/ping');
    const third = await app.request('/ping');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
  });

  it('allows up to the limit, then returns 429 with Retry-After and a RATE_LIMITED body', async () => {
    const app = appWithFixedUser({ limit: 2, windowMs: 60_000 }, 'user-1');

    const r1 = await app.request('/ping');
    const r2 = await app.request('/ping');
    const r3 = await app.request('/ping');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);

    const retryAfter = r3.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(await r3.json()).toEqual({ error: 'RATE_LIMITED' });
  });

  it('tracks independent buckets per userId', async () => {
    const app = new Hono<{ Variables: Variables }>();
    let currentUser = 'user-a';
    app.use('*', async (c, next) => {
      c.set('userId', currentUser);
      await next();
    });
    app.get('/ping', rateLimit({ limit: 1, windowMs: 60_000 }), (c) => c.json({ ok: true }));

    const a1 = await app.request('/ping');
    const a2 = await app.request('/ping');
    currentUser = 'user-b';
    const b1 = await app.request('/ping');

    expect(a1.status).toBe(200);
    expect(a2.status).toBe(429);
    expect(b1.status).toBe(200);
  });

  it('falls back to the first x-forwarded-for IP when there is no authenticated userId', async () => {
    const app = new Hono<{ Variables: Variables }>();
    app.get('/ping', rateLimit({ limit: 1, windowMs: 60_000 }), (c) => c.json({ ok: true }));

    const ipA = { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' };
    const ipB = { 'x-forwarded-for': '9.9.9.9' };

    const a1 = await app.request('/ping', { headers: ipA });
    const a2 = await app.request('/ping', { headers: ipA });
    const b1 = await app.request('/ping', { headers: ipB });

    expect(a1.status).toBe(200);
    expect(a2.status).toBe(429); // same first IP (1.2.3.4) as a1
    expect(b1.status).toBe(200); // different IP -> independent bucket
  });

  it('falls back to a constant key when there is neither a userId nor x-forwarded-for', async () => {
    const app = new Hono<{ Variables: Variables }>();
    app.get('/ping', rateLimit({ limit: 1, windowMs: 60_000 }), (c) => c.json({ ok: true }));

    const a1 = await app.request('/ping');
    const a2 = await app.request('/ping');

    expect(a1.status).toBe(200);
    expect(a2.status).toBe(429);
  });

  it('resets the window once windowMs has elapsed', async () => {
    vi.useFakeTimers();
    const app = appWithFixedUser({ limit: 1, windowMs: 1_000 }, 'user-1');

    const r1 = await app.request('/ping');
    const r2 = await app.request('/ping');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(429);

    vi.advanceTimersByTime(1_001);

    const r3 = await app.request('/ping');
    expect(r3.status).toBe(200);
  });
});
