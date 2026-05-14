import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    cart: { findUnique: vi.fn() },
    subscription: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    product: { findUnique: vi.fn(), update: vi.fn() },
    productSubscriptionPrice: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    pet: { findFirst: vi.fn() },
    order: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    orderItem: {},
    $transaction: vi.fn(),
  },
}));

vi.mock('../../src/services/stripeService.js', () => ({
  createSubscriptionCheckoutSession: vi.fn(),
  ensureStripeSubscriptionProductId: vi.fn(),
  createStripeRecurringPrice: vi.fn(),
  stripePauseSubscription: vi.fn(),
  stripeResumeSubscription: vi.fn(),
  stripeCancelSubscriptionAtPeriodEnd: vi.fn(),
  stripeCancelSubscriptionImmediately: vi.fn(),
  stripeUpdateSubscriptionItemsProrationNone: vi.fn(),
}));

vi.mock('../../src/services/emailService.js', () => ({
  sendOrderConfirmation: vi.fn(),
  sendSubscriptionPaymentIssue: vi.fn(),
  sendUpcomingDeliveryReminder: vi.fn(),
}));

vi.mock('../../src/services/stockAlertService.js', () => ({
  onProductBecameOutOfStock: vi.fn().mockResolvedValue(undefined),
}));

import * as stripeService from '../../src/services/stripeService.js';
import * as emailService from '../../src/services/emailService.js';
import { prisma } from '../../src/lib/prisma.js';
import * as subscriptionService from '../../src/services/subscriptionService.js';

const USER_ID = 'caaaaaaaaaaaaaaaaaaaaaaaa';
const PRODUCT_ID = 'cbbbbbbbbbbbbbbbbbbbbbbb';
const PET_ID = 'cccccccccccccccccccccccc';
const SUB_ID = 'cdddddddddddddddddddddddd';

const mockProduct = {
  id: PRODUCT_ID,
  active: true,
  subscriptionEligible: true,
  price: 1000,
  stock: 5,
};

const mockPriceRow = {
  id: 'psp1',
  productId: PRODUCT_ID,
  interval: 'WEEK_4' as const,
  stripePriceId: 'price_week4',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('subscriptionService.createSubscription', () => {
  it('rejects DISCOUNT_STACKING_NOT_ALLOWED when cart has discountId', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({
      discountId: 'disc1',
    } as never);

    await expect(
      subscriptionService.createSubscription(USER_ID, {
        productId: PRODUCT_ID,
        quantity: 1,
        interval: 'WEEK_4',
      }),
    ).rejects.toMatchObject({ status: 409, message: 'DISCOUNT_STACKING_NOT_ALLOWED' });
  });

  it('rejects SUBSCRIPTIONS_LIMIT_REACHED at cap', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({ discountId: null } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(25);

    await expect(
      subscriptionService.createSubscription(USER_ID, {
        productId: PRODUCT_ID,
        quantity: 1,
        interval: 'WEEK_4',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'SUBSCRIPTIONS_LIMIT_REACHED' });
  });

  it('rejects PRODUCT_NOT_FOUND', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({ discountId: null } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

    await expect(
      subscriptionService.createSubscription(USER_ID, {
        productId: PRODUCT_ID,
        quantity: 1,
        interval: 'WEEK_4',
      }),
    ).rejects.toMatchObject({ status: 404, message: 'PRODUCT_NOT_FOUND' });
  });

  it('rejects PRODUCT_NOT_ACTIVE', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({ discountId: null } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      ...mockProduct,
      active: false,
    } as never);

    await expect(
      subscriptionService.createSubscription(USER_ID, {
        productId: PRODUCT_ID,
        quantity: 1,
        interval: 'WEEK_4',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'PRODUCT_NOT_ACTIVE' });
  });

  it('rejects PRODUCT_NOT_SUBSCRIPTION_ELIGIBLE', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({ discountId: null } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      ...mockProduct,
      subscriptionEligible: false,
    } as never);

    await expect(
      subscriptionService.createSubscription(USER_ID, {
        productId: PRODUCT_ID,
        quantity: 1,
        interval: 'WEEK_4',
      }),
    ).rejects.toMatchObject({ status: 409, message: 'PRODUCT_NOT_SUBSCRIPTION_ELIGIBLE' });
  });

  it('rejects SUBSCRIPTION_PRICE_MISSING', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({ discountId: null } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct as never);
    vi.mocked(prisma.productSubscriptionPrice.findFirst).mockResolvedValue(null);

    await expect(
      subscriptionService.createSubscription(USER_ID, {
        productId: PRODUCT_ID,
        quantity: 1,
        interval: 'WEEK_4',
      }),
    ).rejects.toMatchObject({ status: 409, message: 'SUBSCRIPTION_PRICE_MISSING' });
  });

  it('rejects INSUFFICIENT_STOCK', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({ discountId: null } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      ...mockProduct,
      stock: 1,
    } as never);
    vi.mocked(prisma.productSubscriptionPrice.findFirst).mockResolvedValue(mockPriceRow as never);

    await expect(
      subscriptionService.createSubscription(USER_ID, {
        productId: PRODUCT_ID,
        quantity: 3,
        interval: 'WEEK_4',
      }),
    ).rejects.toMatchObject({ status: 409, message: 'INSUFFICIENT_STOCK' });
  });

  it('rejects PET_NOT_FOUND', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({ discountId: null } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct as never);
    vi.mocked(prisma.productSubscriptionPrice.findFirst).mockResolvedValue(mockPriceRow as never);
    vi.mocked(prisma.pet.findFirst).mockResolvedValue(null);

    await expect(
      subscriptionService.createSubscription(USER_ID, {
        productId: PRODUCT_ID,
        quantity: 1,
        interval: 'WEEK_4',
        petId: PET_ID,
      }),
    ).rejects.toMatchObject({ status: 404, message: 'PET_NOT_FOUND' });
  });

  it('creates checkout session and returns url', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({ discountId: null } as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(0);
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct as never);
    vi.mocked(prisma.productSubscriptionPrice.findFirst).mockResolvedValue(mockPriceRow as never);
    vi.mocked(prisma.pet.findFirst).mockResolvedValue({ id: PET_ID } as never);
    vi.mocked(stripeService.createSubscriptionCheckoutSession).mockResolvedValue({
      url: 'https://stripe.test/checkout',
      checkoutSessionId: 'cs_sub',
    });

    const result = await subscriptionService.createSubscription(USER_ID, {
      productId: PRODUCT_ID,
      quantity: 2,
      interval: 'WEEK_4',
      petId: PET_ID,
    });

    expect(result).toEqual({
      url: 'https://stripe.test/checkout',
      checkoutSessionId: 'cs_sub',
    });
    expect(stripeService.createSubscriptionCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        stripePriceId: 'price_week4',
        quantity: 2,
        subtotalCents: 2000,
        metadata: expect.objectContaining({
          userId: USER_ID,
          productId: PRODUCT_ID,
          petId: PET_ID,
          interval: 'WEEK_4',
        }),
      }),
    );
  });
});

describe('subscriptionService syncSubscriptionFromStripe', () => {
  it('returns null when metadata incomplete', async () => {
    const res = await subscriptionService.syncSubscriptionFromStripe({
      id: 'sub_x',
      metadata: {},
      items: { data: [] },
      status: 'active',
      canceled_at: null,
      pause_collection: null,
      current_period_end: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(res).toBeNull();
  });

  it('upserts subscription row', async () => {
    vi.mocked(prisma.productSubscriptionPrice.findFirst).mockResolvedValue({
      interval: 'WEEK_4',
    } as never);
    vi.mocked(prisma.subscription.upsert).mockResolvedValue({
      id: SUB_ID,
    } as never);

    const stripeSub = {
      id: 'sub_stripe',
      metadata: {
        userId: USER_ID,
        productId: PRODUCT_ID,
        quantity: '2',
        interval: 'WEEK_4',
      },
      items: {
        data: [
          {
            quantity: 2,
            price: { id: 'price_week4' },
          },
        ],
      },
      status: 'active',
      canceled_at: null,
      pause_collection: null,
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
    };

    await subscriptionService.syncSubscriptionFromStripe(stripeSub);

    expect(prisma.subscription.upsert).toHaveBeenCalled();
  });
});

describe('subscriptionService.applyInvoiceToOrder', () => {
  const invoiceBase = {
    id: 'in_123',
    subscription: 'sub_ext',
    amount_paid: 1900,
    payment_intent: 'pi_123',
  };

  const localSub = {
    id: SUB_ID,
    userId: USER_ID,
    productId: PRODUCT_ID,
    quantity: 2,
    discountPercent: 5,
    stripeSubscriptionId: 'sub_ext',
    product: { id: PRODUCT_ID, price: 1000 },
    user: { email: 'u@test.com', name: 'U' },
  };

  it('returns SUBSCRIPTION_NOT_FOUND when no subscription on invoice', async () => {
    const r = await subscriptionService.applyInvoiceToOrder({
      ...invoiceBase,
      subscription: null,
    } as never);
    expect(r.reason).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('returns ALREADY_PROCESSED when order exists', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'ord1',
      status: 'PAID',
    } as never);

    const r = await subscriptionService.applyInvoiceToOrder(invoiceBase as never);
    expect(r.reason).toBe('ALREADY_PROCESSED');
    expect(r.created).toBe(false);
  });

  it('creates PAID order and sends confirmation', async () => {
    vi.mocked(prisma.order.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'neword',
        status: 'PAID',
        totalCents: 1900,
        user: { email: 'u@test.com', name: 'U' },
        items: [
          {
            quantity: 2,
            priceCents: 1000,
            product: { id: PRODUCT_ID, name: 'P' },
          },
        ],
      } as never);

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(localSub as never);

    const txMock = {
      order: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'neword' }),
        update: vi.fn(),
      },
      product: {
        findUnique: vi.fn().mockResolvedValue({ stock: 10 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMock) => Promise<unknown>)(txMock),
    );
    vi.mocked(emailService.sendOrderConfirmation).mockResolvedValue({ ok: true });

    const r = await subscriptionService.applyInvoiceToOrder(invoiceBase as never);

    expect(r.created).toBe(true);
    expect(r.status).toBe('PAID');
    expect(emailService.sendOrderConfirmation).toHaveBeenCalled();
  });

  it('marks CANCELLED and sends payment issue on oversold', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null);

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(localSub as never);

    const txMock = {
      order: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'neword' }),
        update: vi.fn(),
      },
      product: {
        findUnique: vi.fn().mockResolvedValue({ stock: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMock) => Promise<unknown>)(txMock),
    );
    vi.mocked(emailService.sendSubscriptionPaymentIssue).mockResolvedValue({ ok: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await subscriptionService.applyInvoiceToOrder(invoiceBase as never);

    expect(r.reason).toBe('OVERSOLD');
    expect(r.status).toBe('CANCELLED');
    expect(emailService.sendSubscriptionPaymentIssue).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('subscriptionService.updateSubscription', () => {
  it('throws EMPTY_PATCH', async () => {
    await expect(subscriptionService.updateSubscription(USER_ID, SUB_ID, {})).rejects.toMatchObject(
      { status: 400, message: 'EMPTY_PATCH' },
    );
  });

  it('returns null when not owned', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);

    const r = await subscriptionService.updateSubscription(USER_ID, SUB_ID, {
      quantity: 2,
    });
    expect(r).toBeNull();
  });

  it('updates via Stripe and updateMany', async () => {
    vi.mocked(prisma.subscription.findFirst)
      .mockResolvedValueOnce({
        id: SUB_ID,
        stripeSubscriptionId: 'sub_x',
        productId: PRODUCT_ID,
        stripePriceId: 'old',
      } as never)
      .mockResolvedValueOnce({
        id: SUB_ID,
        userId: USER_ID,
        productId: PRODUCT_ID,
        petId: null,
        pet: null,
        quantity: 3,
        interval: 'WEEK_4',
        status: 'ACTIVE',
        discountPercent: 5,
        nextDeliveryAt: new Date(),
        pausedAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        product: { id: PRODUCT_ID, slug: 's', name: 'N', imageUrl: null, price: 1000 },
      } as never);

    vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 1 });

    await subscriptionService.updateSubscription(USER_ID, SUB_ID, { quantity: 3 });

    expect(stripeService.stripeUpdateSubscriptionItemsProrationNone).toHaveBeenCalledWith({
      stripeSubscriptionId: 'sub_x',
      quantity: 3,
    });
  });
});

describe('subscriptionService.pauseSubscription', () => {
  it('returns null when missing', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
    expect(await subscriptionService.pauseSubscription(USER_ID, SUB_ID)).toBeNull();
  });

  it('409 when already PAUSED', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB_ID,
      stripeSubscriptionId: 'sub_x',
      status: 'PAUSED',
      userId: USER_ID,
      productId: PRODUCT_ID,
    } as never);

    await expect(subscriptionService.pauseSubscription(USER_ID, SUB_ID)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('subscriptionService.resumeSubscription', () => {
  it('409 when not PAUSED', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB_ID,
      stripeSubscriptionId: 'sub_x',
      status: 'ACTIVE',
      userId: USER_ID,
      productId: PRODUCT_ID,
    } as never);

    await expect(subscriptionService.resumeSubscription(USER_ID, SUB_ID)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('subscriptionService.cancelSubscription', () => {
  it('409 when CANCELLED', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB_ID,
      stripeSubscriptionId: 'sub_x',
      status: 'CANCELLED',
      userId: USER_ID,
      productId: PRODUCT_ID,
    } as never);

    await expect(subscriptionService.cancelSubscription(USER_ID, SUB_ID)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('calls immediate cancel when requested', async () => {
    vi.mocked(prisma.subscription.findFirst)
      .mockResolvedValueOnce({
        id: SUB_ID,
        stripeSubscriptionId: 'sub_x',
        status: 'ACTIVE',
        userId: USER_ID,
        productId: PRODUCT_ID,
      } as never)
      .mockResolvedValueOnce({
        id: SUB_ID,
        userId: USER_ID,
        productId: PRODUCT_ID,
        petId: null,
        pet: null,
        quantity: 1,
        interval: 'WEEK_4',
        status: 'ACTIVE',
        discountPercent: 5,
        nextDeliveryAt: new Date(),
        pausedAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        product: { id: PRODUCT_ID, slug: 's', name: 'N', imageUrl: null, price: 1000 },
      } as never);

    await subscriptionService.cancelSubscription(USER_ID, SUB_ID, { immediate: true });

    expect(stripeService.stripeCancelSubscriptionImmediately).toHaveBeenCalledWith('sub_x');
  });
});

describe('subscriptionService.markProductSubscriptionEligible', () => {
  it('404 when product missing', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

    await expect(
      subscriptionService.markProductSubscriptionEligible(PRODUCT_ID),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('subscriptionService.sendUpcomingDeliveryRemindersDue', () => {
  it('returns scanned counts', async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);
    const r = await subscriptionService.sendUpcomingDeliveryRemindersDue();
    expect(r).toEqual({ scanned: 0, sent: 0, failed: 0, skipped: 0 });
  });
});
