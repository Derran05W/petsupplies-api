import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    cart: { findUnique: vi.fn() },
    order: { create: vi.fn(), update: vi.fn() },
    cartItem: { deleteMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
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
    coupons: {
      retrieve: vi.fn(),
      create: vi.fn(),
    },
    customers: {
      create: vi.fn(),
    },
    subscriptions: {
      update: vi.fn(),
      cancel: vi.fn(),
      retrieve: vi.fn(),
    },
    prices: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
    products: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/discountService.js', () => ({
  validateById: vi.fn(),
}));

import * as discountService from '../../src/services/discountService.js';
import { encodeSelectionToken } from '../../src/lib/shippingSelection.js';
import { prisma } from '../../src/lib/prisma.js';
import { stripe } from '../../src/lib/stripe.js';
import * as shippingService from '../../src/services/shippingService.js';
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
  discountId: null,
  discount: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [mockCartItem],
};

function makeTxMock(orderOverride: Record<string, unknown> = {}) {
  return {
    order: {
      create: vi.fn().mockResolvedValue({ ...mockOrder, ...orderOverride }),
    },
    cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cart: { update: vi.fn().mockResolvedValue({}) },
  };
}

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
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'user-1',
    email: 'user@example.com',
    stripeCustomerId: 'cus_existing',
  } as never);
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
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

      const txMock = makeTxMock({
        totalCents: 4599,
        subtotalCents: 4000,
        shippingCents: 599,
        taxCents: 0,
        discountCents: 0,
      });
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
      const localTxMock = makeTxMock({
        totalCents: 4599,
        subtotalCents: 4000,
        shippingCents: 599,
        taxCents: 0,
        discountCents: 0,
      });
      await txMockCall(localTxMock);

      expect(localTxMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            status: 'PENDING',
            subtotalCents: 4000,
            shippingCents: 599,
            taxCents: 0,
            discountCents: 0,
            totalCents: 4599,
          }),
        }),
      );
    });

    it('snapshots priceCents from product.price in OrderItems', async () => {
      await stripeService.createCheckoutSessionFromCart('user-1');

      const txMockCall = (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const localTxMock = makeTxMock({
        totalCents: 4599,
        subtotalCents: 4000,
        shippingCents: 599,
        taxCents: 0,
        discountCents: 0,
      });
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
      const localTxMock = makeTxMock({
        totalCents: 4599,
        subtotalCents: 4000,
        shippingCents: 599,
        taxCents: 0,
        discountCents: 0,
      });
      await txMockCall(localTxMock);

      expect(localTxMock.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'cart-1' },
      });
      expect(localTxMock.cart.update).toHaveBeenCalledWith({
        where: { id: 'cart-1' },
        data: { discountId: null },
      });
    });

    it('calls stripe.checkout.sessions.create with correct shape', async () => {
      await stripeService.createCheckoutSessionFromCart('user-1');

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          customer: 'cus_existing',
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
          payment_intent_data: { metadata: { orderId: 'order-1' } },
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

      const shippingCents = subtotalCents >= 5000 ? 0 : 599;
      const totalCents = subtotalCents + shippingCents;
      const txMock = makeTxMock({
        totalCents,
        subtotalCents,
        shippingCents,
        taxCents: 0,
        discountCents: 0,
      });
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
          customer: 'cus_existing',
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
          customer: 'cus_existing',
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

      const txMock = makeTxMock({
        totalCents: 4599,
        subtotalCents: 4000,
        shippingCents: 599,
        taxCents: 0,
        discountCents: 0,
      });
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

  describe('shipping selection', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('applies selected live rate when token validates', async () => {
      vi.spyOn(shippingService, 'resolveDestinationPostal').mockResolvedValue('K1A0B1');
      vi.mocked(prisma.cart.findUnique).mockResolvedValue(mockCart as never);
      const destPostal = 'K1A0B1';
      const fp = shippingService.cartFingerprintFromItems([{ productId: 'prod-1', quantity: 2 }]);
      const token = encodeSelectionToken(process.env.STRIPE_WEBHOOK_SECRET!, {
        expiresAtMs: Date.now() + 120_000,
        userId: 'user-1',
        cartFingerprint: fp,
        destPostalCode: destPostal,
        serviceCode: 'DOM.EP',
        serviceName: 'Expedited Parcel',
        amountCents: 1299,
        carrier: 'CANADA_POST',
        shipQuoteSource: 'canada_post',
      });

      const txMock = makeTxMock({
        subtotalCents: 4000,
        shippingCents: 1299,
        taxCents: 0,
        discountCents: 0,
        totalCents: 5299,
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
        (cb as (tx: unknown) => unknown)(txMock),
      );
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValue(mockSession as never);
      vi.mocked(prisma.order.update).mockResolvedValue(mockOrder as never);

      await stripeService.createCheckoutSessionFromCart('user-1', {
        selectionToken: token,
        serviceCode: 'DOM.EP',
        amountCents: 1299,
        line1: '1 St',
        city: 'Ottawa',
        region: 'ON',
        postalCode: 'K1A 0B1',
        country: 'CA',
      });

      expect(txMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shippingCents: 1299,
            shipServiceCode: 'DOM.EP',
            shipQuoteSource: 'canada_post',
          }),
        }),
      );
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shipping_options: [
            expect.objectContaining({
              shipping_rate_data: expect.objectContaining({
                display_name: 'Expedited Parcel',
                fixed_amount: { amount: 1299, currency: 'cad' },
              }),
            }),
          ],
        }),
      );
    });

    it('throws 409 when shipping token expired', async () => {
      vi.spyOn(shippingService, 'resolveDestinationPostal').mockResolvedValue('K1A0B1');
      vi.mocked(prisma.cart.findUnique).mockResolvedValue(mockCart as never);
      const fp = shippingService.cartFingerprintFromItems([{ productId: 'prod-1', quantity: 2 }]);
      const token = encodeSelectionToken(process.env.STRIPE_WEBHOOK_SECRET!, {
        expiresAtMs: Date.now() - 1000,
        userId: 'user-1',
        cartFingerprint: fp,
        destPostalCode: 'K1A0B1',
        serviceCode: 'DOM.EP',
        serviceName: 'X',
        amountCents: 100,
        carrier: 'CANADA_POST',
        shipQuoteSource: 'canada_post',
      });

      await expect(
        stripeService.createCheckoutSessionFromCart('user-1', {
          selectionToken: token,
          serviceCode: 'DOM.EP',
          amountCents: 100,
          line1: '1 St',
          city: 'Ottawa',
          region: 'ON',
          postalCode: 'K1A 0B1',
          country: 'CA',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });
});

describe('stripeService.createCheckoutSessionFromCart discount flows', () => {
  beforeEach(() => {
    vi.mocked(discountService.validateById).mockReset();
  });

  it('revalidates validateById and passes Stripe coupon for percentage discount', async () => {
    vi.mocked(discountService.validateById).mockResolvedValue({
      ok: true,
      discount: {
        discountId: 'd1',
        code: 'SAVE10',
        type: 'PERCENTAGE',
        value: 10,
        discountCents: 400,
        shippingDiscountCents: 0,
        stripeCouponId: 'cp_pct',
      },
    });
    const cartWithDisc = {
      ...mockCart,
      discountId: 'd1',
      discount: { id: 'd1', code: 'SAVE10' },
    };
    vi.mocked(prisma.cart.findUnique).mockResolvedValue(cartWithDisc as never);
    const txMock = makeTxMock({
      subtotalCents: 4000,
      shippingCents: 599,
      taxCents: 0,
      discountCents: 400,
      totalCents: 4199,
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: unknown) => unknown)(txMock),
    );
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValue(mockSession as never);
    vi.mocked(prisma.order.update).mockResolvedValue(mockOrder as never);

    await stripeService.createCheckoutSessionFromCart('user-1');

    expect(discountService.validateById).toHaveBeenCalledWith('d1', 'user-1', 4000);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_existing',
        discounts: [{ coupon: 'cp_pct' }],
        metadata: { orderId: 'order-1', discountId: 'd1' },
      }),
    );
    expect(txMock.cart.update).toHaveBeenCalled();
  });

  it('does not pass discounts for FREE_SHIPPING but uses zero shipping option below threshold', async () => {
    vi.mocked(discountService.validateById).mockResolvedValue({
      ok: true,
      discount: {
        discountId: 'd2',
        code: 'FREESHIP',
        type: 'FREE_SHIPPING',
        value: 0,
        discountCents: 0,
        shippingDiscountCents: 599,
        stripeCouponId: null,
      },
    });
    const cartWithDisc = { ...mockCart, discountId: 'd2', discount: { id: 'd2' } };
    vi.mocked(prisma.cart.findUnique).mockResolvedValue(cartWithDisc as never);
    const txMock = makeTxMock({
      subtotalCents: 4000,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents: 4000,
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: unknown) => unknown)(txMock),
    );
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValue(mockSession as never);
    vi.mocked(prisma.order.update).mockResolvedValue(mockOrder as never);

    await stripeService.createCheckoutSessionFromCart('user-1');

    const arg = vi.mocked(stripe.checkout.sessions.create).mock.calls[0]?.[0];
    expect(arg).toBeDefined();
    expect(arg?.discounts).toBeUndefined();
    expect(arg?.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount).toBe(0);
  });

  it('throws 409 when stored discount becomes invalid before checkout', async () => {
    vi.mocked(discountService.validateById).mockResolvedValue({
      ok: false,
      reason: 'EXPIRED',
    });
    const cartWithDisc = { ...mockCart, discountId: 'd1', discount: { id: 'd1' } };
    vi.mocked(prisma.cart.findUnique).mockResolvedValue(cartWithDisc as never);
    await expect(stripeService.createCheckoutSessionFromCart('user-1')).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('stripeService subscribe & save helpers', () => {
  beforeEach(() => {
    stripeService.resetSubscribeAndSaveCouponCacheForTests();
    vi.mocked(stripe.coupons.retrieve).mockReset();
    vi.mocked(stripe.coupons.create).mockReset();
  });

  it('getOrCreateSubscribeAndSaveCoupon caches coupon retrieve', async () => {
    vi.mocked(stripe.coupons.retrieve).mockResolvedValue({
      id: 'subscribe-save-5pct',
    } as never);
    const c1 = await stripeService.getOrCreateSubscribeAndSaveCoupon();
    const c2 = await stripeService.getOrCreateSubscribeAndSaveCoupon();
    expect(c1.id).toBe('subscribe-save-5pct');
    expect(stripe.coupons.retrieve).toHaveBeenCalledTimes(1);
    expect(c2).toBe(c1);
  });

  it('stripePauseSubscription sends pause_collection void', async () => {
    vi.mocked(stripe.subscriptions.update).mockResolvedValue({} as never);
    await stripeService.stripePauseSubscription('sub_x');
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      pause_collection: { behavior: 'void' },
    });
  });

  it('stripeResumeSubscription clears pause_collection', async () => {
    vi.mocked(stripe.subscriptions.update).mockResolvedValue({} as never);
    await stripeService.stripeResumeSubscription('sub_x');
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      pause_collection: '',
    });
  });

  it('stripeCancelSubscriptionAtPeriodEnd sets cancel_at_period_end', async () => {
    vi.mocked(stripe.subscriptions.update).mockResolvedValue({} as never);
    await stripeService.stripeCancelSubscriptionAtPeriodEnd('sub_x');
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      cancel_at_period_end: true,
    });
  });

  it('stripeCancelSubscriptionImmediately cancels', async () => {
    vi.mocked(stripe.subscriptions.cancel).mockResolvedValue({} as never);
    await stripeService.stripeCancelSubscriptionImmediately('sub_x');
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_x');
  });

  it('createSubscriptionCheckoutSession builds subscription session', async () => {
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({
      id: 'cs_sub',
      url: 'https://co.test',
    } as never);
    vi.mocked(stripe.coupons.retrieve).mockResolvedValue({
      id: 'subscribe-save-5pct',
    } as never);

    const r = await stripeService.createSubscriptionCheckoutSession({
      userId: 'user-1',
      stripePriceId: 'price_123',
      quantity: 2,
      subtotalCents: 8000,
      metadata: {
        userId: 'user-1',
        productId: 'p1',
        quantity: '2',
        interval: 'WEEK_4',
      },
    });

    expect(r.checkoutSessionId).toBe('cs_sub');
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        discounts: [{ coupon: 'subscribe-save-5pct' }],
      }),
    );
  });

  it('ensureStripeSubscriptionProductId uses existing price product', async () => {
    vi.mocked(stripe.prices.retrieve).mockResolvedValue({
      product: 'prod_existing',
    } as never);
    const id = await stripeService.ensureStripeSubscriptionProductId({
      productId: 'p1',
      productName: 'N',
      existingStripePriceId: 'price_old',
    });
    expect(id).toBe('prod_existing');
  });

  it('stripeUpdateSubscriptionItemsProrationNone updates item', async () => {
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
      items: { data: [{ id: 'si_abc' }] },
    } as never);
    vi.mocked(stripe.subscriptions.update).mockResolvedValue({} as never);
    await stripeService.stripeUpdateSubscriptionItemsProrationNone({
      stripeSubscriptionId: 'sub_x',
      quantity: 4,
      stripePriceId: 'price_new',
    });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_x',
      expect.objectContaining({
        proration_behavior: 'none',
        items: [{ id: 'si_abc', quantity: 4, price: 'price_new' }],
      }),
    );
  });
});
