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

import * as adminCustomerService from '../../src/services/adminCustomerService.js';
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

describe('GET /admin/customers', () => {
  it('returns 401 without auth', async () => {
    const app = createApp();
    const res = await app.request('/admin/customers');
    expect(res.status).toBe(401);
  });

  it('delegates pagination to adminCustomerService when authorized', async () => {
    const token = await signAdminToken('adm');
    vi.mocked(adminCustomerService.listCustomers).mockResolvedValue({
      data: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });

    const app = createApp();
    const res = await app.request('/admin/customers?page=1&limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(adminCustomerService.listCustomers).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
      email: undefined,
      role: undefined,
    });
  });
});

describe('GET /admin/customers/:id', () => {
  it('delegates customer id lookup', async () => {
    const token = await signAdminToken('adm');
    vi.mocked(adminCustomerService.getCustomerDetail).mockResolvedValue({
      id: 'u1',
      email: 'x@example.com',
      name: null,
      role: 'CUSTOMER',
      createdAt: new Date(),
      counts: {
        orders: 0,
        subscriptions: 0,
        addresses: 0,
        reviews: 0,
        wishlist: 0,
        pets: 0,
      },
      lifetimeValueCents: 0,
      lastOrderAt: null,
    });

    const app = createApp();
    const res = await app.request('/admin/customers/u1', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(adminCustomerService.getCustomerDetail).toHaveBeenCalledWith('u1');
  });
});

describe('GET /admin/customers/:id/orders', () => {
  it('delegates to listCustomerOrders', async () => {
    const token = await signAdminToken('adm');
    vi.mocked(adminCustomerService.listCustomerOrders).mockResolvedValue({
      data: [],
      page: 1,
      limit: 15,
      total: 0,
      totalPages: 0,
    });

    const app = createApp();
    const res = await app.request('/admin/customers/u9/orders?limit=15&status=PAID', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(adminCustomerService.listCustomerOrders).toHaveBeenCalledWith('u9', {
      page: 1,
      limit: 15,
      status: 'PAID',
    });
  });
});

describe('GET /admin/customers/:id/subscriptions', () => {
  it('delegates to listCustomerSubscriptions', async () => {
    const token = await signAdminToken('adm');
    vi.mocked(adminCustomerService.listCustomerSubscriptions).mockResolvedValue({
      data: [],
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
    });

    const app = createApp();
    const res = await app.request('/admin/customers/u9/subscriptions?limit=25&status=ACTIVE', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(adminCustomerService.listCustomerSubscriptions).toHaveBeenCalledWith('u9', {
      page: 1,
      limit: 25,
      status: 'ACTIVE',
    });
  });
});
