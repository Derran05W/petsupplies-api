import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../../src/services/adminDashboardService.js', () => ({
  getOverview: vi.fn(),
  getRevenueTimeseries: vi.fn(),
  getTopProducts: vi.fn(),
  getLowStockProducts: vi.fn(),
  getSubscriptionStats: vi.fn(),
  getDiscountStats: vi.fn(),
}));

vi.mock('../../src/services/orderService.js', () => ({
  listUserOrders: vi.fn(),
  getUserOrder: vi.fn(),
  listAdminOrders: vi.fn(),
  getAdminOrder: vi.fn(),
  updateAdminOrderStatus: vi.fn(),
}));

vi.mock('../../src/services/discountService.js', () => ({
  createDiscount: vi.fn(),
  listDiscounts: vi.fn(),
}));

vi.mock('../../src/services/subscriptionService.js', () => ({
  markProductSubscriptionEligible: vi.fn(),
}));

vi.mock('../../src/services/fulfillmentService.js', () => ({
  listFulfillmentQueue: vi.fn(),
  bulkShipOrders: vi.fn(),
  updateOrderTracking: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

import * as adminDashboardService from '../../src/services/adminDashboardService.js';
import { prisma } from '../../src/lib/prisma.js';
import { createApp } from '../../src/app.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

beforeEach(() => vi.clearAllMocks());

async function signAdminToken(sub: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));

  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: sub,
    role: 'ADMIN',
    email: 'admin@example.com',
  } as never);

  return token;
}

describe('GET /admin/analytics/overview', () => {
  it('returns 401 without auth', async () => {
    const app = createApp();
    const res = await app.request('/admin/analytics/overview');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      role: 'CUSTOMER',
      email: 'u@x.com',
    } as never);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));

    const app = createApp();
    const res = await app.request('/admin/analytics/overview', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
  });

  it('calls getOverview when authorized', async () => {
    vi.mocked(adminDashboardService.getOverview).mockResolvedValue({
      range: { from: new Date(), to: new Date() },
      orderCount: 0,
      paidOrderCount: 0,
      revenueCents: 0,
      aovCents: 0,
      byStatus: {
        PENDING: 0,
        PAID: 0,
        SHIPPED: 0,
        FULFILLED: 0,
        CANCELLED: 0,
      },
    });

    const token = await signAdminToken('adm');
    const app = createApp();
    const from = encodeURIComponent('2026-01-01T00:00:00.000Z');
    const to = encodeURIComponent('2026-02-01T00:00:00.000Z');
    const res = await app.request(`/admin/analytics/overview?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(adminDashboardService.getOverview).toHaveBeenCalled();
    const args = vi.mocked(adminDashboardService.getOverview).mock.calls[0];
    expect(args[0]).toBeInstanceOf(Date);
    expect(args[1]).toBeInstanceOf(Date);
  });
});

describe('GET /admin/analytics/products/top', () => {
  it('rejects limit above 50 with 400', async () => {
    const token = await signAdminToken('adm');
    const app = createApp();
    const res = await app.request('/admin/analytics/products/top?limit=99', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /admin/analytics/products/low-stock', () => {
  it('rejects pagination limit above 100', async () => {
    const token = await signAdminToken('adm');
    const app = createApp();
    const res = await app.request('/admin/analytics/products/low-stock?limit=101', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
  });

  it('delegates query to adminDashboardService when authorized', async () => {
    vi.mocked(adminDashboardService.getLowStockProducts).mockResolvedValue({
      data: [{ id: 'p1', slug: 'x', name: 'N', stock: 0, active: true }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    const token = await signAdminToken('adm');
    const app = createApp();
    const res = await app.request('/admin/analytics/products/low-stock?threshold=5', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(adminDashboardService.getLowStockProducts).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: 5, page: 1, limit: 20 }),
    );
  });
});

describe('GET /admin/analytics/revenue-timeseries', () => {
  it('delegates granularity to service', async () => {
    vi.mocked(adminDashboardService.getRevenueTimeseries).mockResolvedValue({
      granularity: 'week',
      points: [],
    });
    const token = await signAdminToken('adm');
    const app = createApp();
    const res = await app.request('/admin/analytics/revenue-timeseries?granularity=week', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(adminDashboardService.getRevenueTimeseries).toHaveBeenCalledWith(
      undefined,
      undefined,
      'week',
    );
  });
});

describe('GET /admin/analytics/products/top happy path', () => {
  it('delegates limit and filters', async () => {
    vi.mocked(adminDashboardService.getTopProducts).mockResolvedValue({ data: [] });
    const token = await signAdminToken('adm');
    const app = createApp();
    const res = await app.request('/admin/analytics/products/top?limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(adminDashboardService.getTopProducts).toHaveBeenCalledWith(undefined, undefined, 10);
  });
});

describe('GET /admin/analytics/subscriptions', () => {
  it('delegates stats load', async () => {
    vi.mocked(adminDashboardService.getSubscriptionStats).mockResolvedValue({
      byStatus: { ACTIVE: 0, PAUSED: 0, CANCELLED: 0 },
      upcomingDeliveries7d: 0,
      upcomingDeliveries30d: 0,
    });
    const token = await signAdminToken('adm');
    const app = createApp();
    const res = await app.request('/admin/analytics/subscriptions', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(adminDashboardService.getSubscriptionStats).toHaveBeenCalled();
  });
});

describe('GET /admin/analytics/discounts', () => {
  it('delegates with optional dates', async () => {
    vi.mocked(adminDashboardService.getDiscountStats).mockResolvedValue({ data: [] });
    const token = await signAdminToken('adm');
    const app = createApp();
    const from = encodeURIComponent('2026-03-01T00:00:00.000Z');
    const to = encodeURIComponent('2026-04-01T00:00:00.000Z');
    const res = await app.request(`/admin/analytics/discounts?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(adminDashboardService.getDiscountStats).toHaveBeenCalled();
    const args = vi.mocked(adminDashboardService.getDiscountStats).mock.calls[0];
    expect(args[0]).toBeInstanceOf(Date);
    expect(args[1]).toBeInstanceOf(Date);
  });
});
