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

describe.sequential('E2E: signup → browse → cart → checkout → webhook → PAID', () => {
  const userId = `e2e_user_${randomUUID()}`;
  const productSlug = `e2e_product_${randomUUID().slice(0, 12)}`;
  const stripeSessionId = `cs_test_${randomUUID().slice(0, 12)}`;
  const paymentIntentId = `pi_test_${randomUUID().slice(0, 12)}`;

  let productId: string | undefined;
  const initialStock = 50;

  beforeAll(async () => {
    const product = await prisma.product.create({
      data: {
        slug: productSlug,
        name: 'E2E Happy Path Product',
        description: 'Created for end-to-end checkout flow tests.',
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
        email: `e2e_${randomUUID()}@petsupplies.test`,
      },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      await prisma.orderItem.deleteMany({ where: { order: { userId } } });
      await prisma.order.deleteMany({ where: { userId } });
      await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
      await prisma.cart.deleteMany({ where: { userId } });
      if (productId) {
        await prisma.product.deleteMany({ where: { id: productId } });
      }
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // best-effort — e.g. no DB or partial setup
    }
  });

  it('completes browse → cart → checkout → webhook → paid order with stock decrement', async () => {
    const app = createApp();
    const token = await signTestUserJwt(userId);

    const browseRes = await app.request(`/products/${productSlug}`);
    expect(browseRes.status).toBe(200);
    const productJson = (await browseRes.json()) as { id: string; slug: string };
    expect(productJson.id).toBe(productId);
    expect(productJson.slug).toBe(productSlug);

    const addCartRes = await app.request('/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId, quantity: QUANTITY }),
    });
    expect(addCartRes.status).toBe(201);

    const createSpy = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({
      id: stripeSessionId,
      url: 'https://checkout.stripe.test/session',
    } as Stripe.Response<Stripe.Checkout.Session>);

    const checkoutRes = await app.request('/checkout/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(createSpy).toHaveBeenCalled();
    createSpy.mockRestore();

    expect(checkoutRes.status).toBe(200);
    const checkoutBody = (await checkoutRes.json()) as { orderId: string; url: string };
    expect(checkoutBody.url).toBe('https://checkout.stripe.test/session');
    const orderId = checkoutBody.orderId;

    const pendingOrder = await prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    expect(pendingOrder).not.toBeNull();
    expect(pendingOrder!.status).toBe('PENDING');
    expect(pendingOrder!.stripeSessionId).toBe(stripeSessionId);
    expect(pendingOrder!.items).toHaveLength(1);
    expect(pendingOrder!.items[0]!.quantity).toBe(QUANTITY);

    const cartAfter = await prisma.cart.findUnique({
      where: { userId },
      include: { items: true },
    });
    expect(cartAfter?.items.length ?? 0).toBe(0);

    const subtotalCents = QUANTITY * UNIT_PRICE_CENTS;
    const expectsShipping =
      subtotalCents < env.FREE_SHIPPING_THRESHOLD_CENTS ? env.FLAT_SHIPPING_CENTS : 0;
    const amountTotalCents = subtotalCents + expectsShipping;

    const sessionPayload = {
      id: stripeSessionId,
      object: 'checkout.session',
      payment_intent: paymentIntentId,
      amount_total: amountTotalCents,
      collected_information: {
        shipping_details: {
          name: 'Ada Test',
          address: {
            line1: '100 Queen St W',
            line2: 'Unit E2E',
            city: 'Toronto',
            state: 'ON',
            postal_code: 'M5H 2N2',
            country: 'CA',
          },
        },
      },
    };

    const rawEventBody = JSON.stringify({
      id: `evt_${randomUUID().slice(0, 24)}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: sessionPayload },
    });

    const webhookRes = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': signStripeWebhookPayload(rawEventBody),
        'Content-Type': 'application/json',
      },
      body: rawEventBody,
    });
    expect(webhookRes.status).toBe(200);

    const orderRes = await app.request(`/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(orderRes.status).toBe(200);
    const orderJson = (await orderRes.json()) as {
      status: string;
      totalCents: number;
      shipName: string | null;
      shipLine1: string | null;
      shipCity: string | null;
      shipRegion: string | null;
      shipPostalCode: string | null;
      shipCountry: string | null;
    };
    expect(orderJson.status).toBe('PAID');
    expect(orderJson.totalCents).toBe(amountTotalCents);
    expect(orderJson.shipName).toBe('Ada Test');
    expect(orderJson.shipLine1).toBe('100 Queen St W');
    expect(orderJson.shipCity).toBe('Toronto');
    expect(orderJson.shipRegion).toBe('ON');
    expect(orderJson.shipPostalCode).toBe('M5H 2N2');
    expect(orderJson.shipCountry).toBe('CA');

    const paid = await prisma.order.findUnique({ where: { id: orderId } });
    expect(paid?.status).toBe('PAID');
    expect(paid?.stripePaymentIntent).toBe(paymentIntentId);

    const updatedProduct = await prisma.product.findUnique({ where: { id: productId } });
    expect(updatedProduct?.stock).toBe(initialStock - QUANTITY);
  });
});
