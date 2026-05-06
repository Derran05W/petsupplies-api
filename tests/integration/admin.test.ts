import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../../src/services/orderService.js', () => ({
  listUserOrders: vi.fn(),
  getUserOrder: vi.fn(),
  listAdminOrders: vi.fn(),
  getAdminOrder: vi.fn(),
  updateAdminOrderStatus: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import * as orderService from '../../src/services/orderService.js';
import { prisma } from '../../src/lib/prisma.js';
import { createApp } from '../../src/app.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

async function signAdminToken(sub: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));

  // adminOnly will query DB — mock it to return an ADMIN user
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: sub,
    role: 'ADMIN',
    email: 'admin@example.com',
  } as never);

  return token;
}

const mockPaginatedOrders = {
  data: [],
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /admin/orders', () => {
  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/admin/orders');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      role: 'CUSTOMER',
      email: 'user@example.com',
    } as never);

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));

    const app = createApp();
    const res = await app.request('/admin/orders', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
  });

  it('forwards validated filters to orderService.listAdminOrders', async () => {
    vi.mocked(orderService.listAdminOrders).mockResolvedValue(mockPaginatedOrders as never);
    const token = await signAdminToken('admin-1');
    const app = createApp();
    const res = await app.request('/admin/orders?status=PAID&page=1&limit=5', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(orderService.listAdminOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAID', page: 1, limit: 5 }),
    );
  });
});

describe('GET /admin/orders/:id', () => {
  it('forwards id to orderService.getAdminOrder', async () => {
    const mockOrder = { id: 'order-1', status: 'PAID', stripePaymentIntent: 'pi_1' };
    vi.mocked(orderService.getAdminOrder).mockResolvedValue(mockOrder as never);
    const token = await signAdminToken('admin-1');
    const app = createApp();
    const res = await app.request('/admin/orders/order-1', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(orderService.getAdminOrder).toHaveBeenCalledWith('order-1');
    const body = await res.json();
    expect(body.stripePaymentIntent).toBe('pi_1');
  });
});

describe('PATCH /admin/orders/:id/status', () => {
  it('rejects SHIPPED status without trackingNumber and carrier', async () => {
    const token = await signAdminToken('admin-1');
    const app = createApp();
    const res = await app.request('/admin/orders/order-1/status', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'SHIPPED' }),
    });

    expect(res.status).toBe(400);
    expect(orderService.updateAdminOrderStatus).not.toHaveBeenCalled();
  });

  it('rejects SHIPPED status with missing carrier', async () => {
    const token = await signAdminToken('admin-1');
    const app = createApp();
    const res = await app.request('/admin/orders/order-1/status', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'SHIPPED', trackingNumber: 'TRACK123' }),
    });

    expect(res.status).toBe(400);
  });

  it('forwards valid SHIPPED payload with tracking to orderService.updateAdminOrderStatus', async () => {
    const mockOrder = { id: 'order-1', status: 'SHIPPED', trackingNumber: 'TRACK123' };
    vi.mocked(orderService.updateAdminOrderStatus).mockResolvedValue(mockOrder as never);
    const token = await signAdminToken('admin-1');
    const app = createApp();
    const res = await app.request('/admin/orders/order-1/status', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'SHIPPED',
        trackingNumber: 'TRACK123',
        carrier: 'Canada Post',
      }),
    });

    expect(res.status).toBe(200);
    expect(orderService.updateAdminOrderStatus).toHaveBeenCalledWith('order-1', {
      status: 'SHIPPED',
      trackingNumber: 'TRACK123',
      carrier: 'Canada Post',
    });
  });

  it('forwards valid CANCELLED payload to service', async () => {
    const mockOrder = { id: 'order-1', status: 'CANCELLED' };
    vi.mocked(orderService.updateAdminOrderStatus).mockResolvedValue(mockOrder as never);
    const token = await signAdminToken('admin-1');
    const app = createApp();
    const res = await app.request('/admin/orders/order-1/status', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'CANCELLED' }),
    });

    expect(res.status).toBe(200);
    expect(orderService.updateAdminOrderStatus).toHaveBeenCalledWith('order-1', {
      status: 'CANCELLED',
    });
  });
});
