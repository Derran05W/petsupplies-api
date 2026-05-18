import { HTTPException } from 'hono/http-exception';
import type { OrderStatus } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import * as orderService from './orderService.js';

const orderQueueSelect = {
  id: true,
  status: true,
  totalCents: true,
  trackingNumber: true,
  carrier: true,
  shippedAt: true,
  createdAt: true,
  shipName: true,
  shipLine1: true,
  shipCity: true,
  shipRegion: true,
  shipPostalCode: true,
  shipCountry: true,
  user: { select: { id: true, email: true, name: true } },
} as const;

function totalPages(total: number, limit: number): number {
  return Math.ceil(total / limit) || 0;
}

export async function listFulfillmentQueue(input: {
  page: number;
  limit: number;
  from?: Date;
  to?: Date;
  /** Defaults to PAID (orders awaiting fulfillment / ship). */
  status?: OrderStatus;
}) {
  const status = input.status ?? ('PAID' as const);
  const where = {
    status,
    ...((input.from ?? input.to)
      ? {
          createdAt: {
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          },
        }
      : {}),
  };

  const skip = (input.page - 1) * input.limit;

  const [total, data] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip,
      take: input.limit,
      select: orderQueueSelect,
    }),
  ]);

  return {
    data,
    page: input.page,
    limit: input.limit,
    total,
    totalPages: totalPages(total, input.limit),
  };
}

export interface BulkShipItem {
  orderId: string;
  trackingNumber: string;
  carrier: string;
}

export interface BulkShipResultRow {
  orderId: string;
  ok: boolean;
  status?: string;
  error?: string;
}

export async function bulkShipOrders(
  items: BulkShipItem[],
): Promise<{ results: BulkShipResultRow[] }> {
  const results: BulkShipResultRow[] = [];

  for (const item of items) {
    try {
      const order = await orderService.updateAdminOrderStatus(item.orderId, {
        status: 'SHIPPED',
        trackingNumber: item.trackingNumber,
        carrier: item.carrier,
      });
      results.push({
        orderId: item.orderId,
        ok: true,
        status: order.status,
      });
    } catch (e) {
      if (e instanceof HTTPException) {
        results.push({
          orderId: item.orderId,
          ok: false,
          error:
            typeof e.message === 'string' ? e.message : 'Invalid transition or precondition failed',
        });
      } else {
        results.push({
          orderId: item.orderId,
          ok: false,
          error: e instanceof Error ? e.message : 'unknown error',
        });
      }
    }
  }

  return { results };
}

export async function updateOrderTracking(
  orderId: string,
  input: { trackingNumber: string; carrier: string },
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true },
  });

  if (!order) {
    throw new HTTPException(404, { message: 'Order not found' });
  }

  if (order.status !== 'SHIPPED' && order.status !== 'FULFILLED') {
    throw new HTTPException(409, {
      message: 'Tracking can only be updated for SHIPPED or FULFILLED orders',
    });
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      trackingNumber: input.trackingNumber,
      carrier: input.carrier,
    },
  });

  const fresh = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      trackingNumber: true,
      carrier: true,
      shippedAt: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true } },
    },
  });

  return fresh!;
}
