import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { errorHandler } from '../../src/middleware/errorHandler.js';

function makeApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.get('/throw', () => {
    throw new Error('something broke');
  });
  app.get('/secret', () => {
    throw new Error('secret db detail');
  });
  app.get('/http-error', () => {
    throw new HTTPException(422, { message: 'Validation failed' });
  });
  app.get('/bad-input', () => {
    throw new HTTPException(400, { message: 'bad input' });
  });
  app.get('/client-status', () => {
    const err = new Error('missing field') as Error & { status: number };
    err.status = 422;
    throw err;
  });
  return app;
}

describe('errorHandler', () => {
  it('returns a generic 500 with no message leak for unhandled errors', async () => {
    const res = await makeApp().request('/throw');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Internal server error');
  });

  it('never leaks the original error message for a genuine 500 (info disclosure)', async () => {
    const res = await makeApp().request('/secret');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret db detail');
    expect(JSON.parse(text)).toEqual({ error: 'Internal server error' });
  });

  it('returns the correct status code and message for HTTPException', async () => {
    const res = await makeApp().request('/http-error');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Validation failed');
  });

  it('surfaces HTTPException(400) message verbatim (intentional client error)', async () => {
    const res = await makeApp().request('/bad-input');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad input');
  });

  it('surfaces the message for a plain error carrying a 4xx status', async () => {
    const res = await makeApp().request('/client-status');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing field');
  });
});
