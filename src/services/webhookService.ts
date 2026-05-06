import Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';

function paymentIntentString(pi: Stripe.Checkout.Session['payment_intent']): string | null {
  return typeof pi === 'string' ? pi : null;
}

export async function handleSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { stripeSessionId: session.id },
    include: { items: true },
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

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'PAID',
          stripePaymentIntent: paymentIntentId,
          totalCents,
        },
      });
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
