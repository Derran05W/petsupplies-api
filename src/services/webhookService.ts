import Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { env } from '../types/env.js';
import * as discountService from './discountService.js';
import { sendOrderConfirmation, sendSubscriptionPaymentIssue } from './emailService.js';
import * as subscriptionService from './subscriptionService.js';
import { onProductBecameOutOfStock } from './stockAlertService.js';

function paymentIntentString(pi: Stripe.Checkout.Session['payment_intent']): string | null {
  return typeof pi === 'string' ? pi : null;
}

async function handleSubscriptionCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const subRef = session.subscription;
  const stripeSubId = typeof subRef === 'string' ? subRef : subRef?.id;
  if (!stripeSubId) {
    console.warn(
      '[webhook] subscription checkout missing subscription id',
      JSON.stringify({
        op: 'handleSubscriptionCheckoutCompleted',
        stripeEventType: 'checkout.session.completed',
      }),
    );
    return;
  }

  const stripeSub = await stripe.subscriptions.retrieve(stripeSubId, {
    expand: ['items.data.price'],
  });

  await subscriptionService.syncSubscriptionFromStripe(stripeSub);
}

export async function handleSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode === 'subscription') {
    await handleSubscriptionCheckoutCompleted(session);
    return;
  }

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

  const productIds = [...new Set(order.items.map((i) => i.productId))];
  const stockBeforeRows = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, stock: true },
  });
  const stockBeforeMap = new Map(stockBeforeRows.map((r) => [r.id, r.stock]));

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

      if (order.discountId) {
        const dr = await discountService.applyToOrder(order.discountId, order.id, tx);
        if (
          !dr.applied &&
          (dr.reason === 'MAX_REDEMPTIONS_REACHED' || dr.reason === 'ALREADY_USED')
        ) {
          throw new Error(`discount_redemption_failed:${dr.reason}`);
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
    if (err instanceof Error && err.message.startsWith('discount_redemption_failed:')) {
      const reason = err.message.slice('discount_redemption_failed:'.length);
      console.error(
        '[discount_redemption_incident]',
        JSON.stringify({
          orderId: order.id,
          discountId: order.discountId,
          reason,
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
    const stockAfterRows = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, stock: true },
    });
    for (const row of stockAfterRows) {
      const before = stockBeforeMap.get(row.id);
      if (before === undefined) continue;
      if (before > 0 && row.stock === 0) {
        void onProductBecameOutOfStock(row.id);
      }
    }

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

export async function handleSubscriptionCreated(sub: Stripe.Subscription): Promise<void> {
  await subscriptionService.syncSubscriptionFromStripe(sub);
}

export async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  await subscriptionService.syncSubscriptionFromStripe(sub);
}

export async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const updated = await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: sub.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date(),
      pausedAt: null,
    },
  });

  if (updated.count === 0) {
    console.warn(
      '[webhook] subscription.deleted: local row missing',
      JSON.stringify({
        op: 'handleSubscriptionDeleted',
        stripeEventType: 'customer.subscription.deleted',
      }),
    );
    return;
  }

  const row = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: sub.id },
    select: { id: true, userId: true, productId: true },
  });
  if (row) {
    console.info(
      JSON.stringify({
        subscriptionId: row.id,
        userId: row.userId,
        productId: row.productId,
        op: 'handleSubscriptionDeleted',
        stripeEventType: 'customer.subscription.deleted',
      }),
    );
  }
}

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const raw = (invoice as { subscription?: string | Stripe.Subscription | null }).subscription;
  if (!raw) {
    return;
  }
  await subscriptionService.applyInvoiceToOrder(invoice);
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const invoiceSubscription = (invoice as { subscription?: string | Stripe.Subscription | null })
    .subscription;
  const stripeSubId =
    typeof invoiceSubscription === 'string' ? invoiceSubscription : invoiceSubscription?.id;

  if (!stripeSubId || !invoice.id) {
    console.warn(
      '[webhook] invoice.payment_failed skipped',
      JSON.stringify({
        op: 'handleInvoicePaymentFailed',
        stripeEventType: 'invoice.payment_failed',
      }),
    );
    return;
  }

  const localSub = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubId },
    include: { user: { select: { email: true, name: true } } },
  });

  if (!localSub) {
    console.warn(
      '[webhook] invoice.payment_failed: subscription missing',
      JSON.stringify({
        op: 'handleInvoicePaymentFailed',
        stripeEventType: 'invoice.payment_failed',
      }),
    );
    return;
  }

  console.warn(
    '[subscription_invoice_payment_failed]',
    JSON.stringify({
      subscriptionId: localSub.id,
      userId: localSub.userId,
      productId: localSub.productId,
      op: 'handleInvoicePaymentFailed',
      stripeEventType: 'invoice.payment_failed',
    }),
  );

  try {
    const result = await sendSubscriptionPaymentIssue({
      subscriptionId: localSub.id,
      to: localSub.user.email,
      customerName: localSub.user.name,
      invoiceId: invoice.id,
    });
    if (!result.ok) {
      console.warn('[email] subscription payment issue failed', {
        subscriptionId: localSub.id,
        providerMessageId: result.messageId,
        error: result.error,
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.warn('[email] subscription payment issue failed', {
      subscriptionId: localSub.id,
      error: message,
    });
  }
}
