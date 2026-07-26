import { createMiddleware } from 'hono/factory';
import { prisma } from '../lib/prisma.js';
import type { Variables } from '../types/hono.js';

const adminSelect = { id: true, role: true, email: true } as const;

export const adminOnly = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const userId = c.get('userId');
  const jwtAppAdmin = c.get('jwtAppAdmin');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: adminSelect,
  });

  if (user?.role === 'ADMIN') {
    c.set('user', user);
    await next();
    return;
  }

  if (jwtAppAdmin && user) {
    const promoted = await prisma.user.update({
      where: { id: userId },
      data: { role: 'ADMIN' },
      select: adminSelect,
    });
    // Structured audit trail for auto-promotion (F8). De-provisioning is currently manual
    // (SQL UPDATE — see docs/deployment.md); auto-demoting when jwtAppAdmin is false is an
    // explicitly deferred policy decision (it would lock out admins provisioned directly via
    // DB SQL, who never carry an app_metadata admin claim).
    console.warn(
      '[admin_auto_promote]',
      JSON.stringify({ userId, email: user.email, op: 'adminOnly.autoPromote' }),
    );
    c.set('user', promoted);
    await next();
    return;
  }

  if (jwtAppAdmin && !user) {
    const body: { error: string; message?: string } = { error: 'Forbidden' };
    if (process.env.NODE_ENV !== 'production') {
      body.message =
        'Admin JWT is valid but no public.User row exists. Apply sync_auth_user trigger or sign up once.';
    }
    return c.json(body, 403);
  }

  return c.json({ error: 'Forbidden' }, 403);
});
