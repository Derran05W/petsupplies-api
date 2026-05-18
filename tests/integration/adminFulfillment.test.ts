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

vi.mock('../../src/services/adminCustomerService.js', () => ({
  listCustomers: vi.fn(),
  getCustomerDetail: vi.fn(),
  listCustomerOrders: vi.fn(),
  listCustomerSubscriptions: vi.fn(),
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
  prisma: { user: { findUnique: vi.fn() } },
}));

import * as fulfillmentService from '../../src/services/fulfillmentService.js';
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

describe('GET /admin/fulfillment/queue', () => {
  it('returns 401 without auth', async () => {
    const app = createApp();
    const res = await app.request('/admin/fulfillment/queue');
    expect(res.status).toBe(401);
  });

  it('delegates to listFulfillmentQueue', async () => {
    vi.mocked(fulfillmentService.listFulfillmentQueue).mockResolvedValue({
      data: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });

    const token = await signAdminToken('adm');
    const app = createApp();
    const res = await app.request('/admin/fulfillment/queue?status=PENDING', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(fulfillmentService.listFulfillmentQueue).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING', page: 1, limit: 20 }),
    );
  });
});

describe('POST /admin/fulfillment/bulk-ship', () => {
  it('rejects more than 50 items via Zod', async () => {
    const token = await signAdminToken('adm');
    const app = createApp();
    const items = Array.from({ length: 51 }, (_, i) => ({
      orderId: `o${i}`,
      trackingNumber: 'T',
      carrier: 'C',
    }));
    const res = await app.request('/admin/fulfillment/bulk-ship', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items }),
    });

    expect(res.status).toBe(400);
  });

  it('delegates to bulkShipOrders', async () => {
    vi.mocked(fulfillmentService.bulkShipOrders).mockResolvedValue({
      results: [{ orderId: 'o1', ok: true }],
    });

    const token = await signAdminToken('adm');
    const app = createApp();
    const res = await app.request('/admin/fulfillment/bulk-ship', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ orderId: 'o1', trackingNumber: 'T1', carrier: 'FedEx' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(fulfillmentService.bulkShipOrders).toHaveBeenCalledWith([
      { orderId: 'o1', trackingNumber: 'T1', carrier: 'FedEx' },
    ]);
  });
});

describe('PATCH /admin/orders/:id/tracking', () => {
  it('delegates tracking update body to fulfillmentService', async () => {
    const token = await signAdminToken('adm');
    vi.mocked(fulfillmentService.updateOrderTracking).mockResolvedValue({
      id: 'o1',
      status: 'SHIPPED',
      trackingNumber: 'N1',
      carrier: 'C1',
      shippedAt: null,
      createdAt: new Date(),
      user: { id: 'u', email: 'e@example.com', name: null },
    });

    const app = createApp();
    const res = await app.request('/admin/orders/o1/tracking', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trackingNumber: 'N1', carrier: 'C1' }),
    });

    expect(res.status).toBe(200);
    expect(fulfillmentService.updateOrderTracking).toHaveBeenCalledWith('o1', {
      trackingNumber: 'N1',
      carrier: 'C1',
    });
  });

  it('rejects empty body fields via Zod', async () => {
    const token = await signAdminToken('adm');
    const app = createApp();
    const res = await app.request('/admin/orders/o1/tracking', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});
