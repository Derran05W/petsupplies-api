import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../../src/services/orderService.js', () => ({
  listUserOrders: vi.fn(),
  getUserOrder: vi.fn(),
  listAdminOrders: vi.fn(),
  getAdminOrder: vi.fn(),
  updateAdminOrderStatus: vi.fn(),
}));

// adminOnly reads from DB — provide a stub so the mock path doesn't crash
vi.mock('../../src/lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

import * as orderService from '../../src/services/orderService.js';
import { createApp } from '../../src/app.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

async function signToken(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .sign(new TextEncoder().encode(SECRET));
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

describe('GET /orders', () => {
  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/orders');
    expect(res.status).toBe(401);
  });

  it('forwards validated pagination and status query to orderService.listUserOrders', async () => {
    vi.mocked(orderService.listUserOrders).mockResolvedValue(mockPaginatedOrders as never);

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/orders?page=2&limit=10&status=PAID', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(orderService.listUserOrders).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ page: 2, limit: 10, status: 'PAID' }),
    );
  });

  it('rejects invalid status values with 400', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/orders?status=INVALID', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /orders/:id', () => {
  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/orders/order-1');
    expect(res.status).toBe(401);
  });

  it('forwards userId and id to orderService.getUserOrder', async () => {
    const mockOrder = { id: 'order-1', status: 'PAID', totalCents: 2000 };
    vi.mocked(orderService.getUserOrder).mockResolvedValue(mockOrder as never);

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/orders/order-1', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(orderService.getUserOrder).toHaveBeenCalledWith('user-1', 'order-1');
    const body = await res.json();
    expect(body.id).toBe('order-1');
  });
});
