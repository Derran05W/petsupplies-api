import { Prisma } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';
import { env } from '../types/env.js';
import { sendBackInStockAlert } from './emailService.js';

export type StockAlertSortOption = 'newest' | 'oldest';

export interface StockAlertProductSnapshot {
  id: string;
  name: string;
  slug: string;
  price: number;
  active: boolean;
  stock: number;
}

export interface StockAlertItemResponse {
  id: string;
  createdAt: Date;
  notifiedAt: Date | null;
  product: StockAlertProductSnapshot;
}

export interface PaginatedStockAlerts {
  data: StockAlertItemResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AddStockAlertResult {
  item: StockAlertItemResponse;
  created: boolean;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const MAX_STOCK_ALERTS_PER_USER = 500;

const productSelect = {
  id: true,
  name: true,
  slug: true,
  price: true,
  active: true,
  stock: true,
} as const;

const sortMap: Record<StockAlertSortOption, Prisma.StockAlertOrderByWithRelationInput> = {
  newest: { createdAt: 'desc' },
  oldest: { createdAt: 'asc' },
};

type StockAlertWithProduct = Prisma.StockAlertGetPayload<{
  include: { product: { select: typeof productSelect } };
}>;

function toItemResponse(row: StockAlertWithProduct): StockAlertItemResponse {
  return {
    id: row.id,
    createdAt: row.createdAt,
    notifiedAt: row.notifiedAt,
    product: {
      id: row.product.id,
      name: row.product.name,
      slug: row.product.slug,
      price: row.product.price,
      active: row.product.active,
      stock: row.product.stock,
    },
  };
}

/**
 * When sellable stock hits zero: advance episode and clear pending-notification markers.
 *
 * The PAID-decrement and subscription-invoice-decrement paths perform an equivalent
 * atomic CAS inside their own `$transaction` (see `webhookService.handleSessionCompleted`
 * and `subscriptionService.applyInvoiceToOrder`) so they don't call this helper —
 * doing the episode bump as part of the same tx avoids double-fire under concurrent
 * decrements landing the product at `stock = 0`. This export remains for any future
 * caller (e.g. an admin force-OOS tool) that needs to mark a product OOS outside
 * a hot decrement path.
 */
export async function onProductBecameOutOfStock(productId: string): Promise<void> {
  await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      data: { stockAlertEpisode: { increment: 1 } },
    }),
    prisma.stockAlert.updateMany({
      where: { productId },
      data: { notifiedAt: null },
    }),
  ]);
}

/**
 * Wraps a fire-and-forget stock-alert side-effect with an id-only error log so
 * a transient DB / Resend failure never becomes an unhandled promise rejection.
 * Stock mutations must not block on these dispatches (see `docs/cron.md`).
 */
export function fireAndForgetStockAlertOp(
  promise: Promise<unknown>,
  op: 'onProductBecameOutOfStock' | 'dispatchBackInStockNotifications',
  ids: { productId: string },
): void {
  promise.catch((err) => {
    console.warn(
      JSON.stringify({
        op,
        evt: 'inline_dispatch_error',
        productId: ids.productId,
        code: err instanceof Error ? err.name : 'UNKNOWN',
      }),
    );
  });
}

export interface DispatchBackInStockStats {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Sends alerts for rows still pending (`notifiedAt` null) while the product is in stock and active.
 * Failures do not throw; callers use returned counters for job metrics.
 */
export async function dispatchBackInStockNotifications(
  productId: string,
): Promise<DispatchBackInStockStats> {
  const stats: DispatchBackInStockStats = { attempted: 0, sent: 0, failed: 0, skipped: 0 };

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      slug: true,
      stock: true,
      active: true,
      stockAlertEpisode: true,
    },
  });

  if (!product || product.stock <= 0 || !product.active) {
    return stats;
  }

  const alerts = await prisma.stockAlert.findMany({
    where: {
      productId,
      notifiedAt: null,
    },
    include: { user: { select: { email: true } } },
  });

  const productUrl = `${env.FRONTEND_URL}/products/${product.slug}`;

  for (const alert of alerts) {
    stats.attempted += 1;

    const fresh = await prisma.stockAlert.findUnique({
      where: { id: alert.id },
      select: { notifiedAt: true },
    });
    if (!fresh || fresh.notifiedAt) {
      stats.skipped += 1;
      continue;
    }

    const email = alert.user.email?.trim();
    if (!email) {
      stats.skipped += 1;
      console.warn(
        JSON.stringify({
          op: 'dispatchBackInStockNotifications',
          evt: 'stock_alert_skip_no_email',
          userId: alert.userId,
          productId,
          alertId: alert.id,
        }),
      );
      continue;
    }

    const result = await sendBackInStockAlert({
      productId: product.id,
      productName: product.name,
      productUrl,
      to: email,
      userId: alert.userId,
      stockAlertEpisode: product.stockAlertEpisode,
    });

    if (result.ok) {
      const stamp = await prisma.stockAlert.updateMany({
        where: { id: alert.id, notifiedAt: null },
        data: { notifiedAt: new Date() },
      });
      if (stamp.count === 0) {
        stats.skipped += 1;
      } else {
        stats.sent += 1;
      }
    } else {
      stats.failed += 1;
      console.warn(
        JSON.stringify({
          op: 'dispatchBackInStockNotifications',
          evt: 'stock_alert_send_failed',
          userId: alert.userId,
          productId,
          alertId: alert.id,
          code: result.error ?? 'SEND_FAILED',
        }),
      );
    }
  }

  return stats;
}

export async function listStockAlerts(input: {
  userId: string;
  page: number;
  limit: number;
  sort: StockAlertSortOption;
}): Promise<PaginatedStockAlerts> {
  const page = Math.max(1, input.page <= 0 ? 1 : input.page);
  const rawLimit = input.limit <= 0 ? DEFAULT_LIMIT : input.limit;
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));
  const skip = (page - 1) * limit;
  const orderBy = sortMap[input.sort];

  const [rows, total] = await Promise.all([
    prisma.stockAlert.findMany({
      where: { userId: input.userId },
      orderBy,
      skip,
      take: limit,
      include: { product: { select: productSelect } },
    }),
    prisma.stockAlert.count({ where: { userId: input.userId } }),
  ]);

  return {
    data: rows.map(toItemResponse),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
  };
}

export async function addStockAlert(input: {
  userId: string;
  productId: string;
}): Promise<AddStockAlertResult> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, stock: true, active: true },
  });

  if (!product) {
    throw new HTTPException(404, { message: 'NOT_FOUND' });
  }
  if (!product.active) {
    throw new HTTPException(409, { message: 'PRODUCT_INACTIVE' });
  }
  if (product.stock > 0) {
    throw new HTTPException(409, { message: 'IN_STOCK' });
  }

  const currentCount = await prisma.stockAlert.count({ where: { userId: input.userId } });
  if (currentCount >= MAX_STOCK_ALERTS_PER_USER) {
    throw new HTTPException(400, { message: 'STOCK_ALERTS_FULL' });
  }

  try {
    const created = await prisma.stockAlert.create({
      data: { userId: input.userId, productId: input.productId },
      include: { product: { select: productSelect } },
    });
    console.info(
      JSON.stringify({
        userId: input.userId,
        productId: input.productId,
        op: 'stock_alert_add',
      }),
    );
    return { item: toItemResponse(created), created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await prisma.stockAlert.findUnique({
        where: { userId_productId: { userId: input.userId, productId: input.productId } },
        include: { product: { select: productSelect } },
      });
      if (!existing) {
        throw e;
      }
      console.info(
        JSON.stringify({
          userId: input.userId,
          productId: input.productId,
          op: 'stock_alert_add',
          reason: 'duplicate_noop',
        }),
      );
      return { item: toItemResponse(existing), created: false };
    }
    throw e;
  }
}

export async function removeStockAlert(input: {
  userId: string;
  productId: string;
}): Promise<void> {
  await prisma.stockAlert.deleteMany({
    where: { userId: input.userId, productId: input.productId },
  });
  console.info(
    JSON.stringify({
      userId: input.userId,
      productId: input.productId,
      op: 'stock_alert_remove',
    }),
  );
}
