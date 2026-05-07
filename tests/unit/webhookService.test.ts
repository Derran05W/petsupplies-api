import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    order: { findUnique: vi.fn(), update: vi.fn() },
    product: {},
    $transaction: vi.fn(),
  },
}));

vi.mock('../../src/services/emailService.js', () => ({
  sendOrderConfirmation: vi.fn(),
}));

vi.mock('../../src/services/discountService.js', () => ({
  applyToOrder: vi.fn(),
}));

import * as discountService from '../../src/services/discountService.js';
import { prisma } from '../../src/lib/prisma.js';
import { sendOrderConfirmation } from '../../src/services/emailService.js';
import * as webhookService from '../../src/services/webhookService.js';

const orderItem = {
  id: 'oi-1',
  orderId: 'order-1',
  productId: 'prod-1',
  quantity: 2,
  priceCents: 500,
  product: { id: 'prod-1', name: 'Kibble' },
};
const pendingOrderWithItems = {
  id: 'order-1',
  userId: 'user-1',
  status: 'PENDING' as const,
  totalCents: 5000,
  stripeSessionId: 'cs_test_123',
  stripePaymentIntent: null,
  user: { email: 'buyer@example.com', name: 'Buyer' },
  items: [orderItem],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function mockFindUniqueAfterPaid(paidOverrides: Record<string, unknown> = {}) {
  vi.mocked(prisma.order.findUnique)
    .mockResolvedValueOnce(pendingOrderWithItems as never)
    .mockResolvedValueOnce({
      ...pendingOrderWithItems,
      status: 'PAID',
      totalCents: 5200,
      stripePaymentIntent: 'pi_test_789',
      ...paidOverrides,
    } as never);
}
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
      vi.mocked(sendOrderConfirmation).mockResolvedValue({ ok: true });
      mockFindUniqueAfterPaid();
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));

      await webhookService.handleSessionCompleted(makeSession({}));

      expect(sendOrderConfirmation).toHaveBeenCalledOnce();
      expect(sendOrderConfirmation).toHaveBeenCalledWith({
        orderId: 'order-1',
        to: 'buyer@example.com',
        customerName: 'Buyer',
        totalCents: 5200,
        items: [
          {
            productId: 'prod-1',
            name: 'Kibble',
            quantity: 2,
            priceCents: 500,
          },
        ],
        orderUrl: 'http://localhost:3000/orders/order-1',
      });

      expect(txMock.$queryRaw).toHaveBeenCalled();
      expect(txMock.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          status: 'PAID',
          stripePaymentIntent: 'pi_test_789',
          totalCents: 5200,
        }),
      });
    });

    it('writes Stripe shipping details to Order snapshot fields', async () => {
      vi.mocked(sendOrderConfirmation).mockResolvedValue({ ok: true });
      mockFindUniqueAfterPaid();
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));

      const sessionWithShipping = makeSession({
        collected_information: {
          shipping_details: {
            name: 'Jane Doe',
            address: {
              line1: '123 Main St',
              line2: 'Apt 4',
              city: 'Toronto',
              state: 'ON',
              postal_code: 'M5V 3A8',
              country: 'CA',
            },
          },
        } as never,
      });

      await webhookService.handleSessionCompleted(sessionWithShipping);

      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          status: 'PAID',
          shipName: 'Jane Doe',
          shipLine1: '123 Main St',
          shipLine2: 'Apt 4',
          shipCity: 'Toronto',
          shipRegion: 'ON',
          shipPostalCode: 'M5V 3A8',
          shipCountry: 'CA',
        }),
      });
    });

    it('no-ops second delivery when status is PAID', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue({
        ...pendingOrderWithItems,
        status: 'PAID',
      } as never);

      await webhookService.handleSessionCompleted(makeSession({}));

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(sendOrderConfirmation).not.toHaveBeenCalled();
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
      expect(sendOrderConfirmation).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('does not send email when lock returns no pending row', async () => {
      vi.mocked(sendOrderConfirmation).mockResolvedValue({ ok: true });
      vi.mocked(prisma.order.findUnique).mockResolvedValue(pendingOrderWithItems as never);
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        product: { updateMany: vi.fn() },
        order: { update: vi.fn() },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));

      await webhookService.handleSessionCompleted(makeSession({}));

      expect(txMock.product.updateMany).not.toHaveBeenCalled();
      expect(txMock.order.update).not.toHaveBeenCalled();
      expect(sendOrderConfirmation).not.toHaveBeenCalled();
    });

    it('resolves and keeps PAID when sendOrderConfirmation returns ok false', async () => {
      vi.mocked(sendOrderConfirmation).mockResolvedValue({
        ok: false,
        error: 'provider unavailable',
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockFindUniqueAfterPaid();
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));

      await expect(webhookService.handleSessionCompleted(makeSession({}))).resolves.toBeUndefined();

      expect(txMock.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[email] order confirmation failed',
        expect.objectContaining({ orderId: 'order-1', template: 'order-confirmation' }),
      );

      warnSpy.mockRestore();
    });

    it('resolves and keeps PAID when sendOrderConfirmation rejects', async () => {
      vi.mocked(sendOrderConfirmation).mockRejectedValue(new Error('unexpected throw'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockFindUniqueAfterPaid();
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));

      await expect(webhookService.handleSessionCompleted(makeSession({}))).resolves.toBeUndefined();

      expect(txMock.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[email] order confirmation failed',
        expect.objectContaining({
          orderId: 'order-1',
          template: 'order-confirmation',
          error: 'unexpected throw',
        }),
      );

      warnSpy.mockRestore();
    });

    it('returns early without tx when session has no matching order', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue(null);

      await webhookService.handleSessionCompleted(makeSession({ id: 'cs_unknown' }));

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(sendOrderConfirmation).not.toHaveBeenCalled();
    });

    it('uses order.totalCents when amount_total is null', async () => {
      vi.mocked(sendOrderConfirmation).mockResolvedValue({ ok: true });
      vi.mocked(prisma.order.findUnique)
        .mockResolvedValueOnce(pendingOrderWithItems as never)
        .mockResolvedValueOnce({
          ...pendingOrderWithItems,
          status: 'PAID',
          totalCents: 5000,
          stripePaymentIntent: 'pi_test_789',
        } as never);
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
          data: expect.objectContaining({ totalCents: 5000, status: 'PAID' }),
        }),
      );

      expect(sendOrderConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCents: 5000,
          orderUrl: 'http://localhost:3000/orders/order-1',
        }),
      );
    });

    it('calls applyToOrder when order has discountId before PAID update', async () => {
      vi.mocked(sendOrderConfirmation).mockResolvedValue({ ok: true });
      vi.mocked(discountService.applyToOrder).mockResolvedValue({ applied: true });
      vi.mocked(prisma.order.findUnique)
        .mockResolvedValueOnce({ ...pendingOrderWithItems, discountId: 'disc-1' } as never)
        .mockResolvedValueOnce({
          ...pendingOrderWithItems,
          status: 'PAID',
          discountId: 'disc-1',
          totalCents: 5200,
          stripePaymentIntent: 'pi_test_789',
        } as never);
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));

      await webhookService.handleSessionCompleted(makeSession({}));

      expect(discountService.applyToOrder).toHaveBeenCalledWith('disc-1', 'order-1', txMock);
      expect(sendOrderConfirmation).toHaveBeenCalledOnce();
    });

    it('does not call applyToOrder for already-PAID deliveries even with discountId', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue({
        ...pendingOrderWithItems,
        status: 'PAID',
        discountId: 'disc-1',
      } as never);
      await webhookService.handleSessionCompleted(makeSession({}));
      expect(discountService.applyToOrder).not.toHaveBeenCalled();
    });

    it('does not call applyToOrder when stock is oversold', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue({
        ...pendingOrderWithItems,
        discountId: 'disc-1',
      } as never);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        order: { update: vi.fn() },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));
      vi.mocked(prisma.order.update).mockResolvedValue({} as never);
      await webhookService.handleSessionCompleted(makeSession({}));
      expect(discountService.applyToOrder).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('cancels order and logs incident when discount redemption hits max redemptions', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue({
        ...pendingOrderWithItems,
        discountId: 'disc-1',
      } as never);
      vi.mocked(discountService.applyToOrder).mockResolvedValue({
        applied: false,
        reason: 'MAX_REDEMPTIONS_REACHED',
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));
      vi.mocked(prisma.order.update).mockResolvedValue({} as never);
      await webhookService.handleSessionCompleted(makeSession({}));
      expect(errSpy).toHaveBeenCalledWith(
        '[discount_redemption_incident]',
        expect.stringContaining('disc-1'),
      );
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'CANCELLED' },
      });
      expect(sendOrderConfirmation).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('cancels order when discount redemption fails with ALREADY_USED', async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue({
        ...pendingOrderWithItems,
        discountId: 'disc-1',
      } as never);
      vi.mocked(discountService.applyToOrder).mockResolvedValue({
        applied: false,
        reason: 'ALREADY_USED',
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
        product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never));
      vi.mocked(prisma.order.update).mockResolvedValue({} as never);
      await webhookService.handleSessionCompleted(makeSession({}));
      expect(errSpy).toHaveBeenCalledWith(
        '[discount_redemption_incident]',
        expect.stringContaining('order-1'),
      );
      expect(sendOrderConfirmation).not.toHaveBeenCalled();
      errSpy.mockRestore();
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
