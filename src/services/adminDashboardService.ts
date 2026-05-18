import { HTTPException } from 'hono/http-exception';
import { type DiscountType } from '@prisma/client';

import { prisma } from '../lib/prisma.js';

const PAID_REVENUE_STATUSES = ['PAID', 'SHIPPED', 'FULFILLED'] as const;

const MS_PER_DAY = 86_400_000;
const MAX_RANGE_DAYS = 366;

function assertRangeBounds(from: Date, to: Date): void {
  if (from > to) {
    throw new HTTPException(400, { message: '`from` must be before or equal to `to`' });
  }
  const spanDays = (to.getTime() - from.getTime()) / MS_PER_DAY;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new HTTPException(400, { message: `Date range must not exceed ${MAX_RANGE_DAYS} days` });
  }
}

/** Default: last 30 days ending now (UTC-aligned to input Dates). */
export function resolveOverviewRange(from?: Date, to?: Date): { from: Date; to: Date } {
  const now = new Date();
  if (from === undefined && to === undefined) {
    const f = new Date(now.getTime() - 30 * MS_PER_DAY);
    return { from: f, to: now };
  }
  const t = to ?? now;
  const f = from ?? new Date(t.getTime() - 30 * MS_PER_DAY);
  assertRangeBounds(f, t);
  return { from: f, to: t };
}

/** Same resolver for analytics endpoints that always require explicit bounds semantics. */
export function resolveBoundedRange(from?: Date, to?: Date): { from: Date; to: Date } {
  return resolveOverviewRange(from, to);
}

export type OverviewByStatus = Record<
  'PENDING' | 'PAID' | 'SHIPPED' | 'FULFILLED' | 'CANCELLED',
  number
>;

export interface OverviewResult {
  range: { from: Date; to: Date };
  orderCount: number;
  paidOrderCount: number;
  revenueCents: number;
  aovCents: number;
  byStatus: OverviewByStatus;
}

export async function getOverview(from?: Date, to?: Date): Promise<OverviewResult> {
  const { from: rf, to: rt } = resolveOverviewRange(from, to);
  const dateWhere = { createdAt: { gte: rf, lte: rt } };

  const [statusRows, aggregatePaid, totalAll] = await Promise.all([
    prisma.order.groupBy({
      by: ['status'],
      where: dateWhere,
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: {
        ...dateWhere,
        status: { in: [...PAID_REVENUE_STATUSES] },
      },
      _sum: { totalCents: true },
      _count: { _all: true },
    }),
    prisma.order.count({ where: dateWhere }),
  ]);

  const byStatus: OverviewByStatus = {
    PENDING: 0,
    PAID: 0,
    SHIPPED: 0,
    FULFILLED: 0,
    CANCELLED: 0,
  };
  for (const row of statusRows) {
    byStatus[row.status] = row._count._all;
  }

  const paidOrderCount = aggregatePaid._count._all ?? 0;
  const revenueCents = aggregatePaid._sum.totalCents ?? 0;
  const aovCents = paidOrderCount === 0 ? 0 : Math.floor(Number(revenueCents) / paidOrderCount);

  return {
    range: { from: rf, to: rt },
    orderCount: totalAll,
    paidOrderCount,
    revenueCents: Number(revenueCents),
    aovCents,
    byStatus,
  };
}

export type RevenueGranularity = 'day' | 'week';

export interface RevenueTimeseriesPoint {
  bucket: string;
  revenueCents: number;
  orderCount: number;
}

export async function getRevenueTimeseries(
  from?: Date,
  to?: Date,
  granularity: RevenueGranularity = 'day',
): Promise<{ granularity: RevenueGranularity; points: RevenueTimeseriesPoint[] }> {
  const { from: rf, to: rt } = resolveBoundedRange(from, to);

  const rows =
    granularity === 'day'
      ? await prisma.$queryRaw<Array<{ bucket: Date; revenue: bigint | null; cnt: bigint | null }>>`
      SELECT date_trunc('day', o."createdAt") AS bucket,
             COALESCE(SUM(o."totalCents"), 0)::bigint AS revenue,
             COUNT(*)::bigint AS cnt
      FROM "Order" o
      WHERE o.status IN ('PAID', 'SHIPPED', 'FULFILLED')
        AND o."createdAt" >= ${rf}
        AND o."createdAt" <= ${rt}
      GROUP BY 1
      ORDER BY 1 ASC
    `
      : await prisma.$queryRaw<Array<{ bucket: Date; revenue: bigint | null; cnt: bigint | null }>>`
      SELECT date_trunc('week', o."createdAt") AS bucket,
             COALESCE(SUM(o."totalCents"), 0)::bigint AS revenue,
             COUNT(*)::bigint AS cnt
      FROM "Order" o
      WHERE o.status IN ('PAID', 'SHIPPED', 'FULFILLED')
        AND o."createdAt" >= ${rf}
        AND o."createdAt" <= ${rt}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

  return {
    granularity,
    points: rows.map((r) => ({
      bucket: r.bucket.toISOString(),
      revenueCents: Number(r.revenue ?? 0n),
      orderCount: Number(r.cnt ?? 0n),
    })),
  };
}

export interface TopProductRow {
  productId: string;
  slug: string;
  name: string;
  unitsSold: number;
  revenueCents: number;
}

export async function getTopProducts(
  from?: Date,
  to?: Date,
  limit = 20,
): Promise<{ data: TopProductRow[] }> {
  const { from: rf, to: rt } = resolveBoundedRange(from, to);
  const capped = Math.min(Math.max(limit, 1), 50);

  const rows = await prisma.$queryRaw<
    Array<{ productId: string; slug: string; name: string; units: bigint; revenue: bigint }>
  >`
    SELECT oi."productId" AS "productId",
           p.slug,
           p.name,
           SUM(oi.quantity)::bigint AS units,
           SUM(oi.quantity * oi."priceCents")::bigint AS revenue
    FROM "OrderItem" oi
    INNER JOIN "Order" o ON oi."orderId" = o.id
    INNER JOIN "Product" p ON oi."productId" = p.id
    WHERE o.status IN ('PAID', 'SHIPPED', 'FULFILLED')
      AND o."createdAt" >= ${rf}
      AND o."createdAt" <= ${rt}
    GROUP BY oi."productId", p.slug, p.name
    ORDER BY revenue DESC
    LIMIT ${capped}
  `;

  return {
    data: rows.map((r) => ({
      productId: r.productId,
      slug: r.slug,
      name: r.name,
      unitsSold: Number(r.units ?? 0n),
      revenueCents: Number(r.revenue ?? 0n),
    })),
  };
}

export async function getLowStockProducts(params: {
  page: number;
  limit: number;
  threshold?: number;
}): Promise<{
  data: Array<{ id: string; slug: string; name: string; stock: number; active: boolean }>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  const threshold =
    typeof params.threshold === 'number' ? Math.min(100_000, Math.max(0, params.threshold)) : 10;
  const { page, limit } = params;
  const skip = (page - 1) * limit;
  const where = { stock: { lte: threshold } };

  const [total, data] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { stock: 'asc' },
      skip,
      take: limit,
      select: { id: true, slug: true, name: true, stock: true, active: true },
    }),
  ]);

  return {
    data,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
  };
}

export interface SubscriptionStatsResult {
  byStatus: Record<'ACTIVE' | 'PAUSED' | 'CANCELLED', number>;
  upcomingDeliveries7d: number;
  upcomingDeliveries30d: number;
}

export async function getSubscriptionStats(): Promise<SubscriptionStatsResult> {
  const now = new Date();
  const d7 = new Date(now.getTime() + 7 * MS_PER_DAY);
  const d30 = new Date(now.getTime() + 30 * MS_PER_DAY);

  const rows = await prisma.subscription.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  const byStatus = { ACTIVE: 0, PAUSED: 0, CANCELLED: 0 };
  for (const r of rows) {
    byStatus[r.status] = r._count._all;
  }

  const [upcomingDeliveries7d, upcomingDeliveries30d] = await Promise.all([
    prisma.subscription.count({
      where: {
        status: 'ACTIVE',
        nextDeliveryAt: { gte: now, lte: d7 },
      },
    }),
    prisma.subscription.count({
      where: {
        status: 'ACTIVE',
        nextDeliveryAt: { gte: now, lte: d30 },
      },
    }),
  ]);

  return { byStatus, upcomingDeliveries7d, upcomingDeliveries30d };
}

export interface DiscountStatRow {
  discountId: string;
  code: string;
  type: DiscountType;
  usedCount: number;
  maxRedemptions: number | null;
  redemptionsInRange: number;
  revenueImpactCents: number;
}

export async function getDiscountStats(
  from?: Date,
  to?: Date,
): Promise<{ data: DiscountStatRow[] }> {
  const { from: rf, to: rt } = resolveBoundedRange(from, to);

  const discounts = await prisma.discount.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      code: true,
      type: true,
      usedCount: true,
      maxRedemptions: true,
    },
  });

  const [usageAgg, revenueAgg] = await Promise.all([
    prisma.discountUsage.groupBy({
      by: ['discountId'],
      where: {
        createdAt: { gte: rf, lte: rt },
      },
      _count: { _all: true },
    }),
    prisma.order.groupBy({
      by: ['discountId'],
      where: {
        discountId: { not: null },
        status: { in: [...PAID_REVENUE_STATUSES] },
        createdAt: { gte: rf, lte: rt },
      },
      _sum: { discountCents: true },
    }),
  ]);

  const usageMap = new Map(usageAgg.map((u) => [u.discountId, u._count._all]));
  const revenueMap = new Map(
    revenueAgg
      .filter(
        (r): r is (typeof revenueAgg)[number] & { discountId: string } => r.discountId !== null,
      )
      .map((r) => [r.discountId, Number(r._sum.discountCents ?? 0)]),
  );

  const data: DiscountStatRow[] = discounts.map((d) => ({
    discountId: d.id,
    code: d.code,
    type: d.type,
    usedCount: d.usedCount,
    maxRedemptions: d.maxRedemptions,
    redemptionsInRange: usageMap.get(d.id) ?? 0,
    revenueImpactCents: revenueMap.get(d.id) ?? 0,
  }));

  return { data };
}
