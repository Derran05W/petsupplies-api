import { createMiddleware } from 'hono/factory';
import { prisma } from '../lib/prisma.js';
import type { Variables } from '../types/hono.js';

export const adminOnly = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const userId = c.get('userId');
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true },
  });
  if (!user || user.role !== 'ADMIN') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  c.set('user', user);
  await next();
});
