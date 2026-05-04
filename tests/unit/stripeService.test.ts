import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    cart: { findUnique: vi.fn() },
    order: { create: vi.fn(), update: vi.fn() },
    cartItem: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import { stripe } from '../../src/lib/stripe.js';
import * as stripeService from '../../src/services/stripeService.js';

const mockProduct = {
  id: 'prod-1',
  name: 'Dog Food',
  slug: 'dog-food',
  price: 2000,
  imageUrl: null,
  stock: 10,
  active: true,
};

const mockCartItem = {
  id: 'item-1',
  cartId: 'cart-1',
  productId: 'prod-1',
  quantity: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
  product: mockProduct,
};

const mockCart = {
  id: 'cart-1',
  userId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [mockCartItem],
};

const mockOrder = {
  id: 'order-1',
  userId: 'user-1',
  status: 'PENDING',
  totalCents: 4000,
  stripeSessionId: null,
  stripePaymentIntent: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSession = {
  id: 'cs_test_123',
  url: 'https://checkout.stripe.com/pay/cs_test_123',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stripeService.createCheckoutSessionFromCart', () => {
  describe('empty cart', () => {
    it('throws HTTPException 400 when cart is null', async () => {
      vi.mocked(prisma.cart.findUnique).mockResolvedValue(null);

      try {
        await stripeService.createCheckoutSessionFromCart('user-1');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HTTPException);
        expect((e as HTTPException).status).toBe(400);
        expect((e as HTTPException).message).toBe('Cart is empty');
      }
    });

    it('throws HTTPException 400 when cart has no items', async () => {
      vi.mocked(prisma.cart.findUnique).mockResolvedValue({
        ...mockCart,
        items: [],
      } as never);

      try {
        await stripeService.createCheckoutSessionFromCart('user-1');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HTTPException);
        expect((e as HTTPException).status).toBe(400);
      }
    });
  });

  describe('product validation', () => {
    it('throws HTTPException 409 when product is inactive', async () => {
      vi.mocked(prisma.cart.findUnique).mockResolvedValue({
        ...mockCart,
        items: [{ ...mockCartItem, product: { ...mockProduct, active: false } }],
      } as never);

      try {
        await stripeService.createCheckoutSessionFromCart('user-1');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HTTPException);
        expect((e as HTTPException).status).toBe(409);
        expect((e as HTTPException).message).toBe('Product no longer available');
      }
    });

    it('throws HTTPException 409 when product stock < item quantity', async () => {
      vi.mocked(prisma.cart.findUnique).mockResolvedValue({
        ...mockCart,
        items: [{ ...mockCartItem, quantity: 5, product: { ...mockProduct, stock: 3 } }],
      } as never);

      try {
        await stripeService.createCheckoutSessionFromCart('user-1');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HTTPException);
        expect((e as HTTPException).status).toBe(409);
        expect((e as HTTPException).message).toBe(`Insufficient stock for ${mockProduct.name}`);
      }
    });
  });

  describe('happy path', () => {
    beforeEach(() => {
      vi.mocked(prisma.cart.findUnique).mockResolvedValue(mockCart as never);

      const txMock = {
        order: { create: vi.fn().mockResolvedValue(mockOrder) },
        cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue(mockSession as never);
      vi.mocked(prisma.order.update).mockResolvedValue({
        ...mockOrder,
        stripeSessionId: 'cs_test_123',
      } as never);
    });

    it('calls prisma.$transaction once', async () => {
      await stripeService.createCheckoutSessionFromCart('user-1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('creates order with PENDING status and correct totalCents', async () => {
      await stripeService.createCheckoutSessionFromCart('user-1');

      const txMockCall = (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const localTxMock = {
        order: { create: vi.fn().mockResolvedValue(mockOrder) },
        cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      await txMockCall(localTxMock);

      expect(localTxMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            status: 'PENDING',
            totalCents: 4000, // 2 * 2000
          }),
        }),
      );
    });

    it('snapshots priceCents from product.price in OrderItems', async () => {
      await stripeService.createCheckoutSessionFromCart('user-1');

      const txMockCall = (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const localTxMock = {
        order: { create: vi.fn().mockResolvedValue(mockOrder) },
        cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      await txMockCall(localTxMock);

      expect(localTxMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: {
              create: [
                expect.objectContaining({
                  productId: 'prod-1',
                  quantity: 2,
                  priceCents: 2000,
                }),
              ],
            },
          }),
        }),
      );
    });

    it('calls tx.cartItem.deleteMany with the cart id inside the transaction', async () => {
      await stripeService.createCheckoutSessionFromCart('user-1');

      const txMockCall = (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const localTxMock = {
        order: { create: vi.fn().mockResolvedValue(mockOrder) },
        cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      await txMockCall(localTxMock);

      expect(localTxMock.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'cart-1' },
      });
    });

    it('calls stripe.checkout.sessions.create with correct shape', async () => {
      await stripeService.createCheckoutSessionFromCart('user-1');

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          line_items: [
            expect.objectContaining({
              quantity: 2,
              price_data: expect.objectContaining({
                currency: 'cad',
                unit_amount: 2000,
              }),
            }),
          ],
          shipping_address_collection: { allowed_countries: ['CA'] },
          automatic_tax: { enabled: true },
          client_reference_id: 'user-1',
          metadata: { orderId: 'order-1' },
        }),
      );
    });

    it('persists stripeSessionId on the order after Stripe call', async () => {
      await stripeService.createCheckoutSessionFromCart('user-1');

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { stripeSessionId: 'cs_test_123' },
      });
    });

    it('returns { url, orderId } matching stripe response', async () => {
      const result = await stripeService.createCheckoutSessionFromCart('user-1');

      expect(result).toEqual({
        url: 'https://checkout.stripe.com/pay/cs_test_123',
        orderId: 'order-1',
      });
    });
  });

  describe('shipping_options branching', () => {
    const setupMocks = (subtotalCents: number) => {
      const quantity = 1;
      const price = subtotalCents;
      const cartWithPrice = {
        ...mockCart,
        items: [
          {
            ...mockCartItem,
            quantity,
            product: { ...mockProduct, price },
          },
        ],
      };
      vi.mocked(prisma.cart.findUnique).mockResolvedValue(cartWithPrice as never);

      const txMock = {
        order: { create: vi.fn().mockResolvedValue({ ...mockOrder, totalCents: subtotalCents }) },
        cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue(mockSession as never);
      vi.mocked(prisma.order.update).mockResolvedValue(mockOrder as never);
    };

    it('uses flat rate when subtotal < FREE_SHIPPING_THRESHOLD_CENTS', async () => {
      setupMocks(4000); // below 5000 threshold

      await stripeService.createCheckoutSessionFromCart('user-1');

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shipping_options: [
            expect.objectContaining({
              shipping_rate_data: expect.objectContaining({
                display_name: 'Standard shipping',
                tax_behavior: 'exclusive',
                fixed_amount: expect.objectContaining({
                  currency: 'cad',
                  amount: 599,
                }),
              }),
            }),
          ],
        }),
      );
    });

    it('uses free shipping when subtotal >= FREE_SHIPPING_THRESHOLD_CENTS', async () => {
      setupMocks(5000); // exactly at threshold

      await stripeService.createCheckoutSessionFromCart('user-1');

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shipping_options: [
            expect.objectContaining({
              shipping_rate_data: expect.objectContaining({
                display_name: 'Free shipping',
                tax_behavior: 'exclusive',
                fixed_amount: expect.objectContaining({
                  currency: 'cad',
                  amount: 0,
                }),
              }),
            }),
          ],
        }),
      );
    });

    it('uses free shipping when subtotal > FREE_SHIPPING_THRESHOLD_CENTS', async () => {
      setupMocks(7500); // above threshold

      await stripeService.createCheckoutSessionFromCart('user-1');

      const callArg = vi.mocked(stripe.checkout.sessions.create).mock.calls[0][0] as {
        shipping_options: Array<{
          shipping_rate_data: { fixed_amount: { amount: number } };
        }>;
      };
      expect(callArg.shipping_options[0].shipping_rate_data.fixed_amount.amount).toBe(0);
    });
  });

  describe('session.url null', () => {
    it('throws HTTPException 500 when session.url is null', async () => {
      vi.mocked(prisma.cart.findUnique).mockResolvedValue(mockCart as never);

      const txMock = {
        order: { create: vi.fn().mockResolvedValue(mockOrder) },
        cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      );

      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
        id: 'cs_test_no_url',
        url: null,
      } as never);
      vi.mocked(prisma.order.update).mockResolvedValue(mockOrder as never);

      try {
        await stripeService.createCheckoutSessionFromCart('user-1');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HTTPException);
        expect((e as HTTPException).status).toBe(500);
      }
    });
  });
});
