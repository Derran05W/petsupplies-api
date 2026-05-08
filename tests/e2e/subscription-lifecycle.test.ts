import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Stripe from 'stripe';
import { ProductCategory } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { stripe } from '../../src/lib/stripe.js';
import { resetSubscribeAndSaveCouponCacheForTests } from '../../src/services/stripeService.js';
import { signTestUserJwt } from '../helpers/jwt.js';
import { signStripeWebhookPayload } from '../helpers/stripe-webhook.js';

const QUANTITY = 2;
const UNIT_PRICE_CENTS = 1000;

function mockStripeSubscription(params: {
  id: string;
  stripePriceId: string;
  userId: string;
  productId: string;
  quantity: number;
  interval: string;
  pause_collection?: Stripe.Subscription.PauseCollection | null;
  status?: Stripe.Subscription.Status;
  canceled_at?: number | null;
  current_period_end?: number;
}): Stripe.Subscription {
  const periodEnd = params.current_period_end ?? Math.floor(Date.now() / 1000) + 86400 * 28;
  return {
    id: params.id,
    object: 'subscription',
    application: null,
    application_fee_percent: null,
    automatic_tax: { enabled: false, liability: null },
    billing_cycle_anchor: periodEnd - 86400,
    billing_cycle_anchor_config: null,
    billing_mode: { flexible: null, type: 'classic' },
    billing_thresholds: null,
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: params.canceled_at ?? null,
    cancellation_details: { comment: null, feedback: null, reason: null },
    collection_method: 'charge_automatically',
    created: Math.floor(Date.now() / 1000),
    currency: 'cad',
    customer: 'cus_mock',
    days_until_due: null,
    default_payment_method: null,
    default_source: null,
    default_tax_rates: [],
    description: null,
    discounts: [],
    ended_at: null,
    invoice_settings: { account_tax_ids: null, issuer: { type: 'self' } },
    items: {
      object: 'list',
      data: [
        {
          id: 'si_mock',
          object: 'subscription_item',
          billing_thresholds: null,
          created: Math.floor(Date.now() / 1000),
          current_period_end: periodEnd,
          current_period_start: periodEnd - 86400 * 28,
          discounts: [],
          metadata: {},
          plan: null,
          price: {
            id: params.stripePriceId,
            object: 'price',
            active: true,
            billing_scheme: 'per_unit',
            created: Math.floor(Date.now() / 1000),
            currency: 'cad',
            custom_unit_amount: null,
            livemode: false,
            lookup_key: null,
            metadata: {},
            nickname: null,
            product: 'prod_mock',
            recurring: {
              interval: 'week',
              interval_count: 4,
              meter: null,
              trial_period_days: null,
            },
            tax_behavior: 'exclusive',
            tiers_mode: null,
            transform_quantity: null,
            type: 'recurring',
            unit_amount: UNIT_PRICE_CENTS,
            unit_amount_decimal: String(UNIT_PRICE_CENTS),
          },
          quantity: params.quantity,
          subscription: params.id,
          tax_rates: [],
        },
      ],
      has_more: false,
      total_count: 1,
      url: `/v1/subscription_items?subscription=${params.id}`,
    },
    latest_invoice: null,
    livemode: false,
    metadata: {
      userId: params.userId,
      productId: params.productId,
      quantity: String(params.quantity),
      interval: params.interval,
      discountPercent: '5',
    },
    next_pending_invoice_item_invoice: null,
    on_behalf_of: null,
    pause_collection: params.pause_collection ?? null,
    payment_settings: {
      payment_method_options: null,
      payment_method_types: null,
      save_default_payment_method: null,
    },
    pending_invoice_item_interval: null,
    pending_setup_intent: null,
    pending_update: null,
    schedule: null,
    start_date: Math.floor(Date.now() / 1000),
    status: params.status ?? 'active',
    test_clock: null,
    transfer_data: null,
    trial_end: null,
    trial_settings: { end_behavior: { missing_payment_method: 'create_invoice' } },
    trial_start: null,
    current_period_end: periodEnd,
    current_period_start: periodEnd - 86400 * 28,
  } as unknown as Stripe.Subscription;
}

async function postStripeWebhook(
  app: ReturnType<typeof createApp>,
  type: string,
  dataObject: unknown,
) {
  const rawBody = JSON.stringify({
    id: `evt_${randomUUID().slice(0, 24)}`,
    object: 'event',
    api_version: '2025-02-24.acacia',
    type,
    data: { object: dataObject },
  });
  return app.request('/webhooks/stripe', {
    method: 'POST',
    headers: {
      'stripe-signature': signStripeWebhookPayload(rawBody),
      'Content-Type': 'application/json',
    },
    body: rawBody,
  });
}

describe.sequential('E2E: Subscribe & Save lifecycle (webhooks + order idempotency)', () => {
  const userId = `e2e_sub_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const productSlug = `e2e_sub_prod_${randomUUID().slice(0, 12)}`;
  const stripeSessionId = `cs_test_${randomUUID().slice(0, 16)}`;
  const stripeSubId = `sub_test_${randomUUID().slice(0, 16)}`;
  const stripePriceId = `price_e2e_${randomUUID().slice(0, 16)}`;
  const invoiceId = `in_test_${randomUUID().slice(0, 16)}`;
  const paymentIntentId = `pi_test_${randomUUID().slice(0, 16)}`;

  let productId: string | undefined;
  const initialStock = 80;

  beforeEach(() => {
    resetSubscribeAndSaveCouponCacheForTests();
  });

  beforeAll(async () => {
    const product = await prisma.product.create({
      data: {
        slug: productSlug,
        name: 'E2E Subscription Product',
        description: 'Subscribe & Save E2E.',
        price: UNIT_PRICE_CENTS,
        stock: initialStock,
        category: ProductCategory.DOG,
        active: true,
        subscriptionEligible: true,
      },
    });
    productId = product.id;

    await prisma.productSubscriptionPrice.create({
      data: {
        productId: product.id,
        interval: 'WEEK_4',
        stripePriceId,
        active: true,
      },
    });

    await prisma.user.create({
      data: {
        id: userId,
        email: `e2e_sub_${randomUUID()}@petsupplies.test`,
      },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      await prisma.orderItem.deleteMany({ where: { order: { userId } } });
      await prisma.order.deleteMany({ where: { userId } });
      await prisma.subscription.deleteMany({ where: { userId } });
      await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
      await prisma.cart.deleteMany({ where: { userId } });
      if (productId) {
        await prisma.productSubscriptionPrice.deleteMany({ where: { productId } });
        await prisma.product.deleteMany({ where: { id: productId } });
      }
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // best-effort cleanup
    }
  });

  it('checkout.session.completed creates Subscription; invoice.paid idempotent; subscription.updated pause; subscription.deleted', async () => {
    const app = createApp();
    const token = await signTestUserJwt(userId);

    const customerSpy = vi.spyOn(stripe.customers, 'create').mockResolvedValue({
      id: `cus_${randomUUID().slice(0, 24)}`,
    } as Stripe.Response<Stripe.Customer>);
    const couponSpy = vi.spyOn(stripe.coupons, 'retrieve').mockResolvedValue({
      id: 'subscribe-save-5pct',
      object: 'coupon',
    } as Stripe.Response<Stripe.Coupon>);
    const checkoutSpy = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({
      id: stripeSessionId,
      url: 'https://checkout.stripe.test/subscription',
    } as Stripe.Response<Stripe.Checkout.Session>);

    const subPayload = mockStripeSubscription({
      id: stripeSubId,
      stripePriceId,
      userId,
      productId: productId!,
      quantity: QUANTITY,
      interval: 'WEEK_4',
    });

    const retrieveSpy = vi
      .spyOn(stripe.subscriptions, 'retrieve')
      .mockResolvedValue(subPayload as Stripe.Response<Stripe.Subscription>);

    const postSubRes = await app.request('/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productId,
        quantity: QUANTITY,
        interval: 'WEEK_4',
      }),
    });
    expect(postSubRes.status).toBe(200);
    expect(checkoutSpy).toHaveBeenCalled();
    checkoutSpy.mockRestore();
    customerSpy.mockRestore();
    couponSpy.mockRestore();

    const completedBody = {
      id: stripeSessionId,
      object: 'checkout.session',
      mode: 'subscription',
      subscription: stripeSubId,
    };

    const completedRes = await postStripeWebhook(app, 'checkout.session.completed', completedBody);
    expect(completedRes.status).toBe(200);
    retrieveSpy.mockRestore();

    const localSub = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSubId },
    });
    expect(localSub).not.toBeNull();
    expect(localSub!.userId).toBe(userId);
    expect(localSub!.productId).toBe(productId);
    expect(localSub!.quantity).toBe(QUANTITY);
    expect(localSub!.status).toBe('ACTIVE');

    const subtotalCents = UNIT_PRICE_CENTS * QUANTITY;
    const amountPaid = subtotalCents - Math.floor((subtotalCents * 5) / 100);

    const invoicePaidPayload = {
      id: invoiceId,
      object: 'invoice',
      subscription: stripeSubId,
      amount_paid: amountPaid,
      payment_intent: paymentIntentId,
    };

    const paidRes1 = await postStripeWebhook(app, 'invoice.paid', invoicePaidPayload);
    expect(paidRes1.status).toBe(200);

    const ordersAfterFirst = await prisma.order.findMany({
      where: { userId, subscriptionInvoiceId: invoiceId },
    });
    expect(ordersAfterFirst).toHaveLength(1);
    expect(ordersAfterFirst[0]!.status).toBe('PAID');
    expect(ordersAfterFirst[0]!.shippingCents).toBe(0);
    expect(ordersAfterFirst[0]!.taxCents).toBe(0);

    const stockAfterFirst = await prisma.product.findUnique({ where: { id: productId! } });
    expect(stockAfterFirst!.stock).toBe(initialStock - QUANTITY);

    const paidRes2 = await postStripeWebhook(app, 'invoice.paid', invoicePaidPayload);
    expect(paidRes2.status).toBe(200);

    const ordersAfterDup = await prisma.order.count({
      where: { userId, subscriptionInvoiceId: invoiceId },
    });
    expect(ordersAfterDup).toBe(1);

    const stockAfterDup = await prisma.product.findUnique({ where: { id: productId! } });
    expect(stockAfterDup!.stock).toBe(initialStock - QUANTITY);

    const pausedPayload = mockStripeSubscription({
      id: stripeSubId,
      stripePriceId,
      userId,
      productId: productId!,
      quantity: QUANTITY,
      interval: 'WEEK_4',
      pause_collection: { behavior: 'void', resumes_at: null },
    });

    const updatedPauseRes = await postStripeWebhook(
      app,
      'customer.subscription.updated',
      pausedPayload,
    );
    expect(updatedPauseRes.status).toBe(200);

    const pausedRow = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSubId },
    });
    expect(pausedRow!.status).toBe('PAUSED');

    const deletedPayload = {
      ...pausedPayload,
      status: 'canceled' as Stripe.Subscription.Status,
      canceled_at: Math.floor(Date.now() / 1000),
    };

    const deletedRes = await postStripeWebhook(
      app,
      'customer.subscription.deleted',
      deletedPayload,
    );
    expect(deletedRes.status).toBe(200);

    const cancelledRow = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSubId },
    });
    expect(cancelledRow!.status).toBe('CANCELLED');
    expect(cancelledRow!.cancelledAt).not.toBeNull();
  }, 90_000);
});
