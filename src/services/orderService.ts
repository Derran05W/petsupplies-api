import { HTTPException } from 'hono/http-exception';
import type { OrderStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { env } from '../types/env.js';
import { sendShippingNotification } from './emailService.js';

// ── Input / output types ──────────────────────────────────────────────────────

export interface ListUserOrdersInput {
  status?: OrderStatus;
  page: number;
  limit: number;
}

export interface ListAdminOrdersInput {
  status?: OrderStatus;
  userId?: string;
  email?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

export interface UpdateAdminOrderStatusInput {
  status: 'CANCELLED' | 'SHIPPED' | 'FULFILLED';
  trackingNumber?: string;
  carrier?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const orderItemSelect = {
  id: true,
  quantity: true,
  priceCents: true,
  product: {
    select: { id: true, slug: true, name: true, imageUrl: true },
  },
} as const;

function paginate(page: number, limit: number): { skip: number; take: number } {
  return { skip: (page - 1) * limit, take: limit };
}

function totalPages(total: number, limit: number): number {
  return Math.ceil(total / limit);
}

// ── User-facing order queries ─────────────────────────────────────────────────

export async function listUserOrders(userId: string, input: ListUserOrdersInput) {
  const { page, limit, status } = input;
  const where = { userId, ...(status ? { status } : {}) };

  const [total, orders] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(page, limit),
      select: {
        id: true,
        status: true,
        totalCents: true,
        subtotalCents: true,
        shippingCents: true,
        taxCents: true,
        discountCents: true,
        discountCode: true,
        discountType: true,
        discountValue: true,
        trackingNumber: true,
        carrier: true,
        shippedAt: true,
        createdAt: true,
        updatedAt: true,
        subscriptionId: true,
        subscriptionInvoiceId: true,
        items: { select: orderItemSelect },
      },
    }),
  ]);

  return { data: orders, page, limit, total, totalPages: totalPages(total, limit) };
}

export async function getUserOrder(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      status: true,
      totalCents: true,
      subtotalCents: true,
      shippingCents: true,
      taxCents: true,
      discountCents: true,
      discountCode: true,
      discountType: true,
      discountValue: true,
      trackingNumber: true,
      carrier: true,
      shippedAt: true,
      shipName: true,
      shipLine1: true,
      shipLine2: true,
      shipCity: true,
      shipRegion: true,
      shipPostalCode: true,
      shipCountry: true,
      createdAt: true,
      updatedAt: true,
      subscriptionId: true,
      subscriptionInvoiceId: true,
      items: { select: orderItemSelect },
    },
  });

  if (!order) {
    throw new HTTPException(404, { message: 'Order not found' });
  }

  return order;
}

// ── Admin order queries ───────────────────────────────────────────────────────

export async function listAdminOrders(input: ListAdminOrdersInput) {
  const { page, limit, status, userId, email, from, to } = input;

  const where = {
    ...(status ? { status } : {}),
    ...(userId ? { userId } : {}),
    ...(email ? { user: { email: { contains: email, mode: 'insensitive' as const } } } : {}),
    ...((from ?? to)
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const [total, orders] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(page, limit),
      select: {
        id: true,
        status: true,
        totalCents: true,
        subtotalCents: true,
        shippingCents: true,
        taxCents: true,
        discountCents: true,
        discountCode: true,
        discountType: true,
        discountValue: true,
        discountId: true,
        trackingNumber: true,
        carrier: true,
        shippedAt: true,
        createdAt: true,
        updatedAt: true,
        subscriptionId: true,
        subscriptionInvoiceId: true,
        user: { select: { id: true, email: true, name: true } },
        items: { select: orderItemSelect },
      },
    }),
  ]);

  return { data: orders, page, limit, total, totalPages: totalPages(total, limit) };
}

export async function getAdminOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      totalCents: true,
      subtotalCents: true,
      shippingCents: true,
      taxCents: true,
      discountCents: true,
      discountCode: true,
      discountType: true,
      discountValue: true,
      discountId: true,
      stripeSessionId: true,
      stripePaymentIntent: true,
      trackingNumber: true,
      carrier: true,
      shippedAt: true,
      shipName: true,
      shipLine1: true,
      shipLine2: true,
      shipCity: true,
      shipRegion: true,
      shipPostalCode: true,
      shipCountry: true,
      createdAt: true,
      updatedAt: true,
      subscriptionId: true,
      subscriptionInvoiceId: true,
      user: { select: { id: true, email: true, name: true } },
      items: { select: orderItemSelect },
    },
  });

  if (!order) {
    throw new HTTPException(404, { message: 'Order not found' });
  }

  return order;
}

// ── Admin status transitions ──────────────────────────────────────────────────

export async function updateAdminOrderStatus(orderId: string, input: UpdateAdminOrderStatusInput) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      user: { select: { email: true, name: true } },
    },
  });

  if (!order) {
    throw new HTTPException(404, { message: 'Order not found' });
  }

  const { status: targetStatus } = input;

  // Same-status no-op
  if (order.status === targetStatus) {
    return getAdminOrder(orderId);
  }

  const current = order.status;

  // PENDING → CANCELLED: update status only, no stock change
  if (current === 'PENDING' && targetStatus === 'CANCELLED') {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });
    return getAdminOrder(orderId);
  }

  // PAID → SHIPPED: require tracking fields
  if (current === 'PAID' && targetStatus === 'SHIPPED') {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'SHIPPED',
        trackingNumber: input.trackingNumber!,
        carrier: input.carrier!,
        shippedAt: new Date(),
      },
    });

    try {
      const shipResult = await sendShippingNotification({
        orderId,
        to: order.user.email,
        customerName: order.user.name,
        trackingNumber: input.trackingNumber!,
        carrier: input.carrier!,
        orderUrl: `${env.FRONTEND_URL}/orders/${orderId}`,
      });
      if (!shipResult.ok) {
        console.warn('[email] shipping notification failed', {
          template: 'shipping-notification',
          orderId,
          providerMessageId: shipResult.messageId,
          error: shipResult.error,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown error';
      console.warn('[email] shipping notification failed', {
        template: 'shipping-notification',
        orderId,
        error: message,
      });
    }

    return getAdminOrder(orderId);
  }

  // PAID → CANCELLED: restore stock atomically, log incident
  if (current === 'PAID' && targetStatus === 'CANCELLED') {
    await prisma.$transaction(async (tx) => {
      // Lock the order row to prevent concurrent mutations
      await tx.$queryRaw`
        SELECT id FROM "Order"
        WHERE id = ${orderId} AND status = 'PAID'::"OrderStatus"
        FOR UPDATE
      `;

      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      });
    });

    console.error(
      '[admin_cancel_paid_incident]',
      JSON.stringify({
        orderId: order.id,
        stripePaymentIntent: order.stripePaymentIntent,
        refundAmountCents: order.totalCents,
      }),
    );

    return getAdminOrder(orderId);
  }

  // SHIPPED → FULFILLED
  if (current === 'SHIPPED' && targetStatus === 'FULFILLED') {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'FULFILLED' },
    });
    return getAdminOrder(orderId);
  }

  throw new HTTPException(409, { message: 'Invalid status transition' });
}
