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
  app.get('/http-error', () => {
    throw new HTTPException(422, { message: 'Validation failed' });
  });
  return app;
}

describe('errorHandler', () => {
  it('returns 500 with JSON error for unhandled errors', async () => {
    const res = await makeApp().request('/throw');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('something broke');
  });

  it('returns the correct status code for HTTPException', async () => {
    const res = await makeApp().request('/http-error');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Validation failed');
  });
});
