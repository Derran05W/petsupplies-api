import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * `err.message` is only client-safe for intentional client errors: an
 * `HTTPException` we threw ourselves (its message is always author-chosen),
 * or any other error explicitly carrying a 4xx `status`. Everything else —
 * unexpected exceptions, Prisma errors, invariant violations — is a genuine
 * 500 and must NOT leak `err.message` (info disclosure). The full error is
 * still logged server-side via console.error below.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  console.error(err);

  if (err instanceof HTTPException) {
    return c.json({ error: err.message || 'Internal server error' }, err.status);
  }

  const status = (err as { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return c.json({ error: err.message || 'Internal server error' }, status as 400);
  }

  return c.json({ error: 'Internal server error' }, 500);
};
