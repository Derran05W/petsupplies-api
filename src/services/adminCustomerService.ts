import { HTTPException } from 'hono/http-exception';
import type { OrderStatus, SubscriptionStatus, UserRole } from '@prisma/client';

import { prisma } from '../lib/prisma.js';
import * as orderService from './orderService.js';

const PAID_LTV_STATUSES: OrderStatus[] = ['PAID', 'SHIPPED', 'FULFILLED'];

export interface ListCustomersInput {
  page: number;
  limit: number;
  email?: string;
  role?: UserRole;
}

export interface CustomerSummaryRow {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: Date;
  orderCount: number;
  lifetimeValueCents: number;
}

function totalPages(total: number, limit: number): number {
  return Math.ceil(total / limit) || 0;
}

export async function listCustomers(input: ListCustomersInput): Promise<{
  data: CustomerSummaryRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  if (input.email !== undefined && input.email.trim().length < 2) {
    throw new HTTPException(400, {
      message: '`email` search must be at least 2 characters',
    });
  }

  const where = {
    ...(input.email?.trim().length
      ? { email: { contains: input.email.trim(), mode: 'insensitive' as const } }
      : {}),
    ...(input.role ? { role: input.role } : {}),
  };

  const skip = (input.page - 1) * input.limit;

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: input.limit,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
    }),
  ]);

  const ids = users.map((u) => u.id);
  const agg =
    ids.length === 0
      ? []
      : await prisma.order.groupBy({
          by: ['userId'],
          where: {
            userId: { in: ids },
            status: { in: PAID_LTV_STATUSES },
          },
          _sum: { totalCents: true },
        });
  const ltvMap = new Map(agg.map((a) => [a.userId, Number(a._sum.totalCents ?? 0)]));

  const data: CustomerSummaryRow[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
    orderCount: u._count.orders,
    lifetimeValueCents: ltvMap.get(u.id) ?? 0,
  }));

  return {
    data,
    page: input.page,
    limit: input.limit,
    total,
    totalPages: totalPages(total, input.limit),
  };
}

export async function getCustomerDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      _count: {
        select: {
          orders: true,
          subscriptions: true,
          addresses: true,
          reviews: true,
          wishlistItems: true,
          pets: true,
        },
      },
    },
  });

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  const [ltv, lastOrder] = await Promise.all([
    prisma.order.aggregate({
      where: {
        userId,
        status: { in: PAID_LTV_STATUSES },
      },
      _sum: { totalCents: true },
    }),
    prisma.order.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    counts: {
      orders: user._count.orders,
      subscriptions: user._count.subscriptions,
      addresses: user._count.addresses,
      reviews: user._count.reviews,
      wishlist: user._count.wishlistItems,
      pets: user._count.pets,
    },
    lifetimeValueCents: Number(ltv._sum.totalCents ?? 0),
    lastOrderAt: lastOrder?.createdAt ?? null,
  };
}

export async function listCustomerOrders(
  userId: string,
  params: {
    page: number;
    limit: number;
    status?: OrderStatus;
  },
) {
  await assertUserExists(userId);
  return orderService.listAdminOrders({
    userId,
    page: params.page,
    limit: params.limit,
    status: params.status,
  });
}

async function assertUserExists(userId: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!u) throw new HTTPException(404, { message: 'User not found' });
}

export async function listCustomerSubscriptions(
  userId: string,
  input: {
    page: number;
    limit: number;
    status?: SubscriptionStatus;
  },
) {
  await assertUserExists(userId);

  const where = {
    userId,
    ...(input.status ? { status: input.status } : {}),
  };
  const skip = (input.page - 1) * input.limit;

  const [total, data] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: input.limit,
      select: {
        id: true,
        productId: true,
        petId: true,
        quantity: true,
        interval: true,
        status: true,
        discountPercent: true,
        nextDeliveryAt: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
        createdAt: true,
        updatedAt: true,
        pausedAt: true,
        cancelledAt: true,
      },
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
