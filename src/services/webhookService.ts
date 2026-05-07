import Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { env } from '../types/env.js';
import { sendOrderConfirmation } from './emailService.js';

function paymentIntentString(pi: Stripe.Checkout.Session['payment_intent']): string | null {
  return typeof pi === 'string' ? pi : null;
}

export async function handleSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { stripeSessionId: session.id },
    include: {
      user: { select: { email: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!order) {
    console.warn('[webhook] session.completed: order not found', { sessionId: session.id });
    return;
  }

  if (order.status !== 'PENDING') {
    console.log('[webhook] session.completed: already processed', {
      orderId: order.id,
      status: order.status,
    });
    return;
  }

  const paymentIntentId = paymentIntentString(session.payment_intent);
  if (!paymentIntentId) {
    console.warn('[webhook] session.completed: payment_intent missing', {
      orderId: order.id,
      sessionId: session.id,
    });
  }

  const totalCents = session.amount_total ?? order.totalCents;

  let transitionedToPaid = false;

  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Order"
        WHERE id = ${order.id} AND status = 'PENDING'::"OrderStatus"
        FOR UPDATE
      `;
      if (locked.length === 0) {
        return;
      }

      for (const item of order.items) {
        const result = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (result.count === 0) {
          throw new Error(`oversold:${item.productId}`);
        }
      }

      const shipping = session.collected_information?.shipping_details;
      const shipData = shipping
        ? {
            shipName: shipping.name ?? null,
            shipLine1: shipping.address?.line1 ?? null,
            shipLine2: shipping.address?.line2 ?? null,
            shipCity: shipping.address?.city ?? null,
            shipRegion: shipping.address?.state ?? null,
            shipPostalCode: shipping.address?.postal_code ?? null,
            shipCountry: shipping.address?.country ?? null,
          }
        : {};

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'PAID',
          stripePaymentIntent: paymentIntentId,
          totalCents,
          ...shipData,
        },
      });
      transitionedToPaid = true;
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('oversold:')) {
      console.error(
        '[oversold_incident]',
        JSON.stringify({
          orderId: order.id,
          sessionId: session.id,
          stripePaymentIntent: paymentIntentId,
        }),
      );
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });
      return;
    }
    throw err;
  }

  if (transitionedToPaid) {
    try {
      const fresh = await prisma.order.findUnique({
        where: { id: order.id },
        include: {
          user: { select: { email: true, name: true } },
          items: {
            include: {
              product: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!fresh || fresh.status !== 'PAID') {
        console.warn('[email] order confirmation skipped: unexpected post-commit order state', {
          orderId: order.id,
          status: fresh?.status,
        });
        return;
      }

      const result = await sendOrderConfirmation({
        orderId: fresh.id,
        to: fresh.user.email,
        customerName: fresh.user.name,
        totalCents: fresh.totalCents,
        items: fresh.items.map((i) => ({
          productId: i.product.id,
          name: i.product.name,
          quantity: i.quantity,
          priceCents: i.priceCents,
        })),
        orderUrl: `${env.FRONTEND_URL}/orders/${fresh.id}`,
      });

      if (!result.ok) {
        console.warn('[email] order confirmation failed', {
          template: 'order-confirmation',
          orderId: order.id,
          providerMessageId: result.messageId,
          error: result.error,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown error';
      console.warn('[email] order confirmation failed', {
        template: 'order-confirmation',
        orderId: order.id,
        error: message,
      });
    }
  }
}

export async function handleSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { stripeSessionId: session.id },
  });

  if (!order) {
    console.warn('[webhook] session.expired: order not found', { sessionId: session.id });
    return;
  }

  if (order.status !== 'PENDING') {
    console.log('[webhook] session.expired: skip non-pending', {
      orderId: order.id,
      status: order.status,
    });
    return;
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'CANCELLED' },
  });
  console.log('[webhook] session.expired: order cancelled', { orderId: order.id });
}

export async function handlePaymentIntentFailed(intent: Stripe.PaymentIntent): Promise<void> {
  const orderId = intent.metadata?.orderId;
  if (!orderId) {
    console.warn('[webhook] payment_intent.payment_failed: no orderId in metadata', {
      intentId: intent.id,
    });
    return;
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    console.warn('[webhook] payment_intent.payment_failed: order not found', { orderId });
    return;
  }

  if (order.status !== 'PENDING') {
    console.log('[webhook] payment_intent.payment_failed: skip non-pending', {
      orderId: order.id,
      status: order.status,
    });
    return;
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'CANCELLED' },
  });
  console.log('[webhook] payment_intent.payment_failed: order cancelled', {
    orderId: order.id,
  });
}
