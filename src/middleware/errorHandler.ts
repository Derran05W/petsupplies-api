import type { ErrorHandler } from 'hono';

export const errorHandler: ErrorHandler = (err, c) => {
  console.error(err);
  const status = (err as { status?: number }).status;
  const code = typeof status === 'number' && status >= 400 && status < 600 ? status : 500;
  return c.json({ error: err.message || 'Internal server error' }, code as 400 | 500);
};
