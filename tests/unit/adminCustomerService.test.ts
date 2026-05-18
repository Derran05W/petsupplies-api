import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    user: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    order: { groupBy: vi.fn(), aggregate: vi.fn(), findFirst: vi.fn() },
    subscription: { count: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('../../src/services/orderService.js', () => ({
  listAdminOrders: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma.js';
import * as orderService from '../../src/services/orderService.js';
import * as adminCustomerService from '../../src/services/adminCustomerService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('adminCustomerService.listCustomers', () => {
  it('throws 400 when email filter is shorter than 2 chars', async () => {
    await expect(
      adminCustomerService.listCustomers({
        page: 1,
        limit: 20,
        email: 'a',
      }),
    ).rejects.toThrow(HTTPException);
  });

  it('computes lifetimeValueCents via order groupBy for page users', async () => {
    vi.mocked(prisma.user.count).mockResolvedValue(1);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: 'u1',
        email: 'u1@example.com',
        name: 'U One',
        role: 'CUSTOMER',
        createdAt: new Date('2026-01-01'),
        _count: { orders: 3 },
      },
    ] as never);
    vi.mocked(prisma.order.groupBy).mockResolvedValue([
      { userId: 'u1', _sum: { totalCents: 5000 } },
    ] as never);

    const out = await adminCustomerService.listCustomers({ page: 1, limit: 20 });

    expect(out.total).toBe(1);
    expect(out.data[0].lifetimeValueCents).toBe(5000);
    expect(out.data[0].orderCount).toBe(3);
  });
});

describe('adminCustomerService.listCustomerOrders', () => {
  it('forwards userId-scoped listing to orderService.listAdminOrders', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u99' } as never);
    vi.mocked(orderService.listAdminOrders).mockResolvedValue({
      data: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    await adminCustomerService.listCustomerOrders('u99', {
      page: 1,
      limit: 10,
      status: 'PAID',
    });

    expect(orderService.listAdminOrders).toHaveBeenCalledWith({
      userId: 'u99',
      page: 1,
      limit: 10,
      status: 'PAID',
    });
  });

  it('throws 404 when user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(
      adminCustomerService.listCustomerOrders('missing', {
        page: 1,
        limit: 10,
      }),
    ).rejects.toThrow(HTTPException);
  });
});
