import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    order: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    product: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../src/services/emailService.js', () => ({
  sendShippingNotification: vi.fn(),
}));

vi.mock('../../src/services/stockAlertService.js', () => ({
  dispatchBackInStockNotifications: vi.fn().mockResolvedValue({
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  }),
}));

import { prisma } from '../../src/lib/prisma.js';
import { sendShippingNotification } from '../../src/services/emailService.js';
import * as orderService from '../../src/services/orderService.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const orderItem = {
  id: 'oi-1',
  orderId: 'order-1',
  productId: 'prod-1',
  quantity: 2,
  priceCents: 1000,
};

const baseOrder = {
  id: 'order-1',
  userId: 'user-1',
  status: 'PENDING' as const,
  totalCents: 2000,
  stripeSessionId: 'cs_1',
  stripePaymentIntent: null,
  trackingNumber: null,
  carrier: null,
  shippedAt: null,
  shipName: null,
  shipLine1: null,
  shipLine2: null,
  shipCity: null,
  shipRegion: null,
  shipPostalCode: null,
  shipCountry: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  items: [orderItem],
  user: { email: 'customer@example.com', name: 'Customer' },
};

const paidOrder = { ...baseOrder, status: 'PAID' as const, stripePaymentIntent: 'pi_123' };
const shippedOrder = {
  ...paidOrder,
  status: 'SHIPPED' as const,
  trackingNumber: 'TRACK123',
  carrier: 'Canada Post',
  shippedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── listUserOrders ────────────────────────────────────────────────────────────

describe('orderService.listUserOrders', () => {
  it('returns scoped paginated results sorted newest first', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([1, [baseOrder]] as never);

    const result = await orderService.listUserOrders('user-1', { page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.totalPages).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('applies optional status filter', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([0, []] as never);

    await orderService.listUserOrders('user-1', { page: 1, limit: 10, status: 'PAID' });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});

// ── getUserOrder ──────────────────────────────────────────────────────────────

describe('orderService.getUserOrder', () => {
  it('returns order when it belongs to the user', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(baseOrder as never);

    const result = await orderService.getUserOrder('user-1', 'order-1');

    expect(result.id).toBe('order-1');
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1', userId: 'user-1' } }),
    );
  });

  it('throws 404 when order not found', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);

    await expect(orderService.getUserOrder('user-1', 'nope')).rejects.toThrow(HTTPException);
    await expect(orderService.getUserOrder('user-1', 'nope')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws 404 when order belongs to a different user', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null);

    await expect(orderService.getUserOrder('user-other', 'order-1')).rejects.toThrow(HTTPException);
  });
});

// ── listAdminOrders ───────────────────────────────────────────────────────────

describe('orderService.listAdminOrders', () => {
  it('returns paginated results with user email', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([2, [baseOrder, paidOrder]] as never);

    const result = await orderService.listAdminOrders({ page: 1, limit: 20 });

    expect(result.total).toBe(2);
    expect(result.totalPages).toBe(1);
  });

  it('applies status, userId, email, and date filters', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([0, []] as never);

    await orderService.listAdminOrders({
      page: 1,
      limit: 10,
      status: 'PAID',
      userId: 'user-1',
      email: 'test@example.com',
      from: new Date('2026-01-01'),
      to: new Date('2026-12-31'),
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('respects page and limit for offset pagination', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([100, []] as never);

    const result = await orderService.listAdminOrders({ page: 3, limit: 10 });

    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(result.totalPages).toBe(10);
  });
});

// ── getAdminOrder ─────────────────────────────────────────────────────────────

describe('orderService.getAdminOrder', () => {
  it('exposes admin-only fields including stripePaymentIntent', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      ...paidOrder,
      user: { id: 'user-1', email: 'a@b.com', name: null },
    } as never);

    const result = await orderService.getAdminOrder('order-1');

    expect('stripePaymentIntent' in result).toBe(true);
    expect('user' in result).toBe(true);
  });

  it('throws 404 when order absent', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null);

    await expect(orderService.getAdminOrder('nope')).rejects.toMatchObject({ status: 404 });
  });
});

// ── updateAdminOrderStatus ────────────────────────────────────────────────────

describe('orderService.updateAdminOrderStatus', () => {
  function setupFindUnique(order: Record<string, unknown>) {
    vi.mocked(prisma.order.findUnique)
      // First call: load current order with items
      .mockResolvedValueOnce(order as never)
      // Second call: from getAdminOrder after update
      .mockResolvedValueOnce({
        ...order,
        user: { id: 'user-1', email: 'a@b.com', name: null },
      } as never);
  }

  it('same-status returns current order without DB write', async () => {
    const cancelledOrder = { ...baseOrder, status: 'CANCELLED' as const };
    setupFindUnique(cancelledOrder);

    await orderService.updateAdminOrderStatus('order-1', { status: 'CANCELLED' });

    // Same status — no update should be issued
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(sendShippingNotification).not.toHaveBeenCalled();
  });

  it('PENDING → CANCELLED updates status without stock change', async () => {
    setupFindUnique(baseOrder);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);

    await orderService.updateAdminOrderStatus('order-1', { status: 'CANCELLED' });

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'CANCELLED' },
    });
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(sendShippingNotification).not.toHaveBeenCalled();
  });

  it('PAID → SHIPPED sets tracking fields and shippedAt', async () => {
    vi.mocked(sendShippingNotification).mockResolvedValue({ ok: true });
    setupFindUnique(paidOrder);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);

    await orderService.updateAdminOrderStatus('order-1', {
      status: 'SHIPPED',
      trackingNumber: 'TRACK123',
      carrier: 'Canada Post',
    });

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        status: 'SHIPPED',
        trackingNumber: 'TRACK123',
        carrier: 'Canada Post',
        shippedAt: expect.any(Date),
      }),
    });

    expect(sendShippingNotification).toHaveBeenCalledOnce();
    expect(sendShippingNotification).toHaveBeenCalledWith({
      orderId: 'order-1',
      to: 'customer@example.com',
      customerName: 'Customer',
      trackingNumber: 'TRACK123',
      carrier: 'Canada Post',
      orderUrl: 'http://localhost:3000/orders/order-1',
    });
  });

  it('PAID → SHIPPED still returns updated order when email returns ok false', async () => {
    vi.mocked(sendShippingNotification).mockResolvedValue({ ok: false, error: 'down' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupFindUnique(paidOrder);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);

    const result = await orderService.updateAdminOrderStatus('order-1', {
      status: 'SHIPPED',
      trackingNumber: 'TRACK123',
      carrier: 'Canada Post',
    });

    expect(sendShippingNotification).toHaveBeenCalledOnce();
    expect(result.id).toBe('order-1');
    expect(warnSpy).toHaveBeenCalledWith(
      '[email] shipping notification failed',
      expect.objectContaining({ orderId: 'order-1', template: 'shipping-notification' }),
    );
    warnSpy.mockRestore();
  });

  it('PAID → SHIPPED still returns updated order when email rejects', async () => {
    vi.mocked(sendShippingNotification).mockRejectedValue(new Error('transport boom'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupFindUnique(paidOrder);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);

    const result = await orderService.updateAdminOrderStatus('order-1', {
      status: 'SHIPPED',
      trackingNumber: 'TRACK123',
      carrier: 'Canada Post',
    });

    expect(sendShippingNotification).toHaveBeenCalledOnce();
    expect(result.id).toBe('order-1');
    expect(warnSpy).toHaveBeenCalledWith(
      '[email] shipping notification failed',
      expect.objectContaining({
        orderId: 'order-1',
        template: 'shipping-notification',
        error: 'transport boom',
      }),
    );
    warnSpy.mockRestore();
  });

  it('PAID → CANCELLED locks order, restores stock in transaction, and logs [admin_cancel_paid_incident]', async () => {
    setupFindUnique(paidOrder);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const txMock = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
      product: {
        findUnique: vi.fn().mockResolvedValue({ stock: 3 }),
        update: vi.fn().mockResolvedValue({}),
      },
      order: { update: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));

    await orderService.updateAdminOrderStatus('order-1', { status: 'CANCELLED' });

    expect(txMock.$queryRaw).toHaveBeenCalled();
    expect(txMock.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { stock: { increment: 2 } },
    });
    expect(txMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'CANCELLED' },
    });
    expect(errSpy).toHaveBeenCalledWith(
      '[admin_cancel_paid_incident]',
      expect.stringContaining('order-1'),
    );
    expect(sendShippingNotification).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('SHIPPED → FULFILLED marks order fulfilled', async () => {
    setupFindUnique(shippedOrder);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);

    await orderService.updateAdminOrderStatus('order-1', { status: 'FULFILLED' });

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'FULFILLED' },
    });
    expect(sendShippingNotification).not.toHaveBeenCalled();
  });

  it('throws 409 for invalid transition (PENDING → SHIPPED)', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue(baseOrder as never);

    await expect(
      orderService.updateAdminOrderStatus('order-1', {
        status: 'SHIPPED',
        trackingNumber: 'T',
        carrier: 'C',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(sendShippingNotification).not.toHaveBeenCalled();
  });

  it('throws 409 for terminal → any transition (CANCELLED → PAID)', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      ...baseOrder,
      status: 'CANCELLED',
    } as never);

    await expect(
      orderService.updateAdminOrderStatus('order-1', { status: 'FULFILLED' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(sendShippingNotification).not.toHaveBeenCalled();
  });

  it('throws 404 when order not found', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null);

    await expect(
      orderService.updateAdminOrderStatus('nope', { status: 'CANCELLED' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
