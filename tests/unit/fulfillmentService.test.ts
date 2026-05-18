import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/services/orderService.js', () => ({
  updateAdminOrderStatus: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    order: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as orderService from '../../src/services/orderService.js';
import * as fulfillmentService from '../../src/services/fulfillmentService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fulfillmentService.listFulfillmentQueue', () => {
  it('defaults to PAID when status omitted', async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(0);
    vi.mocked(prisma.order.findMany).mockResolvedValue([]);

    await fulfillmentService.listFulfillmentQueue({
      page: 1,
      limit: 5,
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PAID' }),
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('honors explicit status override', async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(0);
    vi.mocked(prisma.order.findMany).mockResolvedValue([]);

    await fulfillmentService.listFulfillmentQueue({
      page: 1,
      limit: 5,
      status: 'SHIPPED',
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'SHIPPED' }),
      }),
    );
  });
});

describe('fulfillmentService.bulkShipOrders', () => {
  it('delegates each item to orderService.updateAdminOrderStatus and aggregates outcomes', async () => {
    vi.mocked(orderService.updateAdminOrderStatus)
      .mockResolvedValueOnce({ id: 'o1', status: 'SHIPPED' } as never)
      .mockRejectedValueOnce(new HTTPException(409, { message: 'Invalid status transition' }));

    const batch = await fulfillmentService.bulkShipOrders([
      { orderId: 'o1', trackingNumber: 'T1', carrier: 'FedEx' },
      { orderId: 'o2', trackingNumber: 'T2', carrier: 'UPS' },
    ]);

    expect(batch.results).toHaveLength(2);
    expect(batch.results[0]).toMatchObject({ orderId: 'o1', ok: true });
    expect(batch.results[1].ok).toBe(false);
    expect(batch.results[1].error).toBe('Invalid status transition');
    expect(orderService.updateAdminOrderStatus).toHaveBeenCalledTimes(2);
    expect(orderService.updateAdminOrderStatus).toHaveBeenNthCalledWith(1, 'o1', {
      status: 'SHIPPED',
      trackingNumber: 'T1',
      carrier: 'FedEx',
    });
  });

  it('captures generic errors as failures', async () => {
    vi.mocked(orderService.updateAdminOrderStatus).mockRejectedValueOnce(new Error('db down'));

    const batch = await fulfillmentService.bulkShipOrders([
      { orderId: 'o9', trackingNumber: 'T', carrier: 'UPS' },
    ]);

    expect(batch.results[0].ok).toBe(false);
    expect(batch.results[0].error).toBe('db down');
  });
});

describe('fulfillmentService.updateOrderTracking', () => {
  it('rejects PAID orders with 409', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'ox',
      status: 'PAID',
    } as never);

    await expect(
      fulfillmentService.updateOrderTracking('ox', { trackingNumber: 'T', carrier: 'C' }),
    ).rejects.toThrow(HTTPException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('updates tracking for SHIPPED orders', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ox',
      status: 'SHIPPED',
    } as never);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ox',
      status: 'SHIPPED',
      trackingNumber: 'NX',
      carrier: 'FedEx',
      shippedAt: new Date(),
      createdAt: new Date(),
      user: { id: 'u', email: 'x@example.com', name: null },
    } as never);

    const updated = await fulfillmentService.updateOrderTracking('ox', {
      trackingNumber: 'NX',
      carrier: 'FedEx',
    });

    expect(prisma.order.update).toHaveBeenCalled();
    expect(updated.trackingNumber).toBe('NX');
  });
});
