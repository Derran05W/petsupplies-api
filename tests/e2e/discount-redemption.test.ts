import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Stripe from 'stripe';
import { ProductCategory } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { stripe } from '../../src/lib/stripe.js';
import { env } from '../../src/types/env.js';
import { signTestUserJwt } from '../helpers/jwt.js';
import { signStripeWebhookPayload } from '../helpers/stripe-webhook.js';

const QUANTITY = 2;
const UNIT_PRICE_CENTS = 1000;

describe.sequential('E2E: discount redemption', () => {
  const userId = `e2e_disc_user_${randomUUID()}`;
  const productSlug = `e2e_disc_prod_${randomUUID().slice(0, 12)}`;
  const stripeSessionId = `cs_disc_${randomUUID().slice(0, 12)}`;
  const paymentIntentId = `pi_disc_${randomUUID().slice(0, 12)}`;
  const discountCode = `D${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const stripeCouponIdForDiscount = `cp_e2e_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  let productId: string | undefined;
  let discountId: string | undefined;
  const initialStock = 50;

  beforeAll(async () => {
    const product = await prisma.product.create({
      data: {
        slug: productSlug,
        name: 'E2E Discount Product',
        description: 'E2E discount flow.',
        price: UNIT_PRICE_CENTS,
        stock: initialStock,
        category: ProductCategory.DOG,
        active: true,
      },
    });
    productId = product.id;

    await prisma.user.create({
      data: {
        id: userId,
        email: `e2e_disc_${randomUUID()}@petsupplies.test`,
      },
    });

    const d = await prisma.discount.create({
      data: {
        code: discountCode,
        type: 'PERCENTAGE',
        value: 10,
        active: true,
        stripeCouponId: stripeCouponIdForDiscount,
      },
    });
    discountId = d.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      await prisma.discountUsage.deleteMany({
        where: { discount: { code: discountCode } },
      });
      await prisma.orderItem.deleteMany({ where: { order: { userId } } });
      await prisma.order.deleteMany({ where: { userId } });
      await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
      await prisma.cart.deleteMany({ where: { userId } });
      if (discountId) {
        await prisma.discount.deleteMany({ where: { id: discountId } });
      }
      if (productId) {
        await prisma.product.deleteMany({ where: { id: productId } });
      }
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // best-effort
    }
  });

  it('writes exactly one DiscountUsage on PAID and absorbs duplicate webhooks; blocks re-apply for same user', async () => {
    const app = createApp();
    const token = await signTestUserJwt(userId);

    const addCartRes = await app.request('/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId, quantity: QUANTITY }),
    });
    expect(addCartRes.status).toBe(201);

    const discRes = await app.request('/cart/discount', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: discountCode }),
    });
    expect(discRes.status).toBe(200);

    vi.spyOn(stripe.customers, 'create').mockResolvedValue({
      id: `cus_${randomUUID().slice(0, 24)}`,
    } as Stripe.Response<Stripe.Customer>);
    const createSpy = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({
      id: stripeSessionId,
      url: 'https://checkout.stripe.test/session',
    } as Stripe.Response<Stripe.Checkout.Session>);

    const checkoutRes = await app.request('/checkout/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(checkoutRes.status).toBe(200);
    createSpy.mockRestore();

    const { orderId } = (await checkoutRes.json()) as { orderId: string };
    const pending = await prisma.order.findUnique({ where: { id: orderId } });
    expect(pending?.discountId).toBe(discountId);
    expect(pending?.stripeSessionId).toBe(stripeSessionId);

    const subtotalCents = QUANTITY * UNIT_PRICE_CENTS;
    const discountCents = Math.floor((subtotalCents * 10) / 100);
    const shippingCents =
      subtotalCents >= env.FREE_SHIPPING_THRESHOLD_CENTS ? 0 : env.FLAT_SHIPPING_CENTS;
    const amountTotalCents = subtotalCents - discountCents + shippingCents;

    const sessionPayload = {
      id: stripeSessionId,
      object: 'checkout.session',
      payment_intent: paymentIntentId,
      amount_total: amountTotalCents,
      collected_information: {
        shipping_details: {
          name: 'Disc Tester',
          address: {
            line1: '1 Discount Ln',
            city: 'Toronto',
            state: 'ON',
            postal_code: 'M5H 2N2',
            country: 'CA',
          },
        },
      },
    };

    const postCompleted = (evtId: string) => {
      const raw = JSON.stringify({
        id: evtId,
        object: 'event',
        type: 'checkout.session.completed',
        data: { object: sessionPayload },
      });
      return app.request('/webhooks/stripe', {
        method: 'POST',
        headers: {
          'stripe-signature': signStripeWebhookPayload(raw),
          'Content-Type': 'application/json',
        },
        body: raw,
      });
    };

    const w1 = await postCompleted(`evt_${randomUUID().slice(0, 24)}`);
    const w2 = await postCompleted(`evt_${randomUUID().slice(0, 24)}`);
    expect(w1.status).toBe(200);
    expect(w2.status).toBe(200);

    const usages = await prisma.discountUsage.findMany({ where: { discountId } });
    expect(usages).toHaveLength(1);

    const dAfter = await prisma.discount.findUnique({ where: { id: discountId! } });
    expect(dAfter?.usedCount).toBe(1);

    const addAgain = await app.request('/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId, quantity: 1 }),
    });
    expect(addAgain.status).toBe(201);

    const replay = await app.request('/cart/discount', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: discountCode }),
    });
    expect(replay.status).toBe(409);
  }, 60_000);
});
