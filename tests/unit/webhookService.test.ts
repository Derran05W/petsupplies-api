import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    order: { findUnique: vi.fn(), update: vi.fn() },
    product: {},
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as webhookService from '../../src/services/webhookService.js';

const orderItem = {
  id: 'oi-1',
  orderId: 'order-1',
  productId: 'prod-1',
  quantity: 2,
  priceCents: 500,
};
const pendingOrderWithItems = {
  id: 'order-1',
  userId: 'user-1',
  status: 'PENDING' as const,
  totalCents: 5000,
  stripeSessionId: 'cs_test_123',
  stripePaymentIntent: null,
  items: [orderItem],
  createdAt: new Date(),
  updatedAt: new Date(),
};
const pendingOrderNoItems = { ...pendingOrderWithItems, items: [] };

function makeSession(overrides: Partial<Stripe.Checkout.Session>): Stripe.Checkout.Session {
  return {
    id: 'cs_test_123',
    payment_intent: 'pi_test_789',
    amount_total: 5200,
    ...overrides,
  } as Stripe.Checkout.Session;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('webhookService', () => {
  describe('handleSessionCompleted', () => {
    it('marks PAID, decrements stock, sets payment intent and totalCents', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue(pendingOrderWithItems as never);
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));

      await webhookService.handleSessionCompleted(makeSession({}));

      expect(txMock.$queryRaw).toHaveBeenCalled();
      expect(txMock.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          status: 'PAID',
          stripePaymentIntent: 'pi_test_789',
          totalCents: 5200,
        },
      });
    });

    it('no-ops second delivery when status is PAID', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue({
        ...pendingOrderWithItems,
        status: 'PAID',
      } as never);

      await webhookService.handleSessionCompleted(makeSession({}));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('cancels on oversold, logs oversold_incident', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue(pendingOrderWithItems as never);

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));
      vi.mocked(prisma.order.update).mockResolvedValue({} as never);

      await webhookService.handleSessionCompleted(makeSession({}));

      expect(errSpy).toHaveBeenCalledWith(
        '[oversold_incident]',
        expect.stringContaining('order-1'),
      );
      expect(errSpy).toHaveBeenCalledWith(
        '[oversold_incident]',
        expect.stringContaining('cs_test_123'),
      );
      expect(errSpy).toHaveBeenCalledWith(
        '[oversold_incident]',
        expect.stringContaining('pi_test_789'),
      );
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'CANCELLED' },
      });
      errSpy.mockRestore();
    });

    it('returns early without tx when session has no matching order', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue(null);

      await webhookService.handleSessionCompleted(makeSession({ id: 'cs_unknown' }));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('uses order.totalCents when amount_total is null', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue(pendingOrderWithItems as never);
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));

      await webhookService.handleSessionCompleted(
        makeSession({ amount_total: null as unknown as number }),
      );

      expect(txMock.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalCents: 5000 }),
        }),
      );
    });
  });

  describe('handleSessionExpired', () => {
    it('cancels PENDING orders', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue(pendingOrderNoItems as never);
      vi.mocked(prisma.order.update).mockResolvedValue({} as never);

      await webhookService.handleSessionExpired(
        makeSession({ id: 'cs_test_123' }) as unknown as Stripe.Checkout.Session,
      );

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'CANCELLED' },
      });
    });

    it('no-op when order is PAID', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue({
        ...pendingOrderNoItems,
        status: 'PAID',
      } as never);

      await webhookService.handleSessionExpired(
        makeSession({}) as unknown as Stripe.Checkout.Session,
      );

      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentIntentFailed', () => {
    it('cancels PENDING order looked up via metadata.orderId', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue(pendingOrderNoItems as never);
      vi.mocked(prisma.order.update).mockResolvedValue({} as never);

      await webhookService.handlePaymentIntentFailed({
        id: 'pi_1',
        metadata: { orderId: 'order-1' },
      } as unknown as Stripe.PaymentIntent);

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'CANCELLED' },
      });
    });

    it('warns when metadata.orderId absent', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await webhookService.handlePaymentIntentFailed({
        id: 'pi_abc',
        metadata: {},
      } as unknown as Stripe.PaymentIntent);

      expect(warnSpy).toHaveBeenCalledWith(
        '[webhook] payment_intent.payment_failed: no orderId in metadata',
        { intentId: 'pi_abc' },
      );
      expect(prisma.order.findUnique).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
