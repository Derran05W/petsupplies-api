import { type Discount, type DiscountType, Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { env } from '../types/env.js';

const CODE_REGEX = /^[A-Z0-9_-]{3,32}$/;

export type DiscountRejectReason =
  | 'INVALID_FORMAT'
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'MIN_CART_NOT_MET'
  | 'MAX_REDEMPTIONS_REACHED'
  | 'ALREADY_USED';

export interface DiscountPreview {
  discountId: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING';
  value: number;
  discountCents: number;
  shippingDiscountCents: number;
  stripeCouponId: string | null;
}

export type ValidateDiscountResult =
  | { ok: true; discount: DiscountPreview }
  | { ok: false; reason: DiscountRejectReason };

export interface CreateDiscountInput {
  code: string;
  type: 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING';
  value: number;
  minCartCents?: number | null;
  maxRedemptions?: number | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  active?: boolean;
}

/** Normalize for lookup/storage; returns null if INVALID_FORMAT (caller maps reason). */
export function normalizeCode(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  if (!CODE_REGEX.test(trimmed)) return null;
  return trimmed;
}

export function computeDiscountCents(
  type: DiscountType,
  value: number,
  subtotalCents: number,
): number {
  switch (type) {
    case 'PERCENTAGE':
      return Math.min(subtotalCents, Math.floor((subtotalCents * value) / 100));
    case 'FIXED':
      return Math.min(value, subtotalCents);
    case 'FREE_SHIPPING':
      return 0;
    default:
      return 0;
  }
}

function nowMs(): number {
  return Date.now();
}

function toPreviewRow(row: Discount, cartSubtotalCents: number): DiscountPreview {
  const discountCents = computeDiscountCents(row.type, row.value, cartSubtotalCents);
  const shippingDiscountCents =
    row.type === 'FREE_SHIPPING' && cartSubtotalCents < env.FREE_SHIPPING_THRESHOLD_CENTS
      ? env.FLAT_SHIPPING_CENTS
      : 0;
  return {
    discountId: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    discountCents,
    shippingDiscountCents,
    stripeCouponId: row.stripeCouponId,
  };
}

async function validateLoaded(
  row: Discount | null,
  userId: string,
  cartSubtotalCents: number,
): Promise<ValidateDiscountResult> {
  if (!row) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (!row.active) {
    return { ok: false, reason: 'INACTIVE' };
  }
  const t = nowMs();
  if (row.validFrom && row.validFrom.getTime() > t) {
    return { ok: false, reason: 'NOT_STARTED' };
  }
  if (row.validUntil && row.validUntil.getTime() < t) {
    return { ok: false, reason: 'EXPIRED' };
  }
  if (row.minCartCents != null && cartSubtotalCents < row.minCartCents) {
    return { ok: false, reason: 'MIN_CART_NOT_MET' };
  }
  if (row.maxRedemptions != null && row.usedCount >= row.maxRedemptions) {
    return { ok: false, reason: 'MAX_REDEMPTIONS_REACHED' };
  }
  const prior = await prisma.discountUsage.findUnique({
    where: {
      discountId_userId: { discountId: row.id, userId },
    },
  });
  if (prior) {
    return { ok: false, reason: 'ALREADY_USED' };
  }
  return { ok: true, discount: toPreviewRow(row, cartSubtotalCents) };
}

export async function validate(
  code: string,
  userId: string,
  cartSubtotalCents: number,
): Promise<ValidateDiscountResult> {
  const normalized = normalizeCode(code);
  if (!normalized) {
    return { ok: false, reason: 'INVALID_FORMAT' };
  }
  const row = await prisma.discount.findUnique({ where: { code: normalized } });
  return validateLoaded(row, userId, cartSubtotalCents);
}

export async function validateById(
  discountId: string,
  userId: string,
  cartSubtotalCents: number,
): Promise<ValidateDiscountResult> {
  const row = await prisma.discount.findUnique({ where: { id: discountId } });
  return validateLoaded(row, userId, cartSubtotalCents);
}

export type ApplyToOrderReason = 'ALREADY_APPLIED' | 'MAX_REDEMPTIONS_REACHED' | 'ALREADY_USED';

/**
 * Records redemption for a paid order. When `tx` is omitted, uses a standalone transaction.
 * Returns failure reasons without throwing — webhook maps to cancel flow.
 */
export async function applyToOrder(
  discountId: string,
  orderId: string,
  tx?: Prisma.TransactionClient,
): Promise<{ applied: boolean; reason?: ApplyToOrderReason }> {
  const run = async (db: Prisma.TransactionClient) => {
    const existingForOrder = await db.discountUsage.findFirst({
      where: { discountId, orderId },
    });
    if (existingForOrder) {
      return { applied: true as const };
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { userId: true },
    });
    if (!order) {
      return { applied: false as const, reason: 'ALREADY_USED' as const };
    }

    const existingForUser = await db.discountUsage.findUnique({
      where: {
        discountId_userId: { discountId, userId: order.userId },
      },
    });
    if (existingForUser) {
      return { applied: false as const, reason: 'ALREADY_USED' as const };
    }

    const updated = await db.$executeRaw(Prisma.sql`
      UPDATE "Discount"
      SET "usedCount" = "usedCount" + 1
      WHERE "id" = ${discountId}
        AND "active" = true
        AND (
          "maxRedemptions" IS NULL
          OR "usedCount" < "maxRedemptions"
        )
    `);
    if (Number(updated) !== 1) {
      return { applied: false as const, reason: 'MAX_REDEMPTIONS_REACHED' as const };
    }

    try {
      await db.discountUsage.create({
        data: {
          discountId,
          userId: order.userId,
          orderId,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Race on @@unique([discountId, userId]): rollback the atomic increment.
        throw new Error('discount_redemption_failed:ALREADY_USED');
      }
      throw e;
    }

    return { applied: true as const };
  };

  if (tx) {
    return run(tx);
  }
  return prisma.$transaction(run);
}

export class StripeCouponRejectedError extends Error {
  constructor(message = 'STRIPE_COUPON_REJECTED') {
    super(message);
    this.name = 'StripeCouponRejectedError';
  }
}

export async function createDiscount(input: CreateDiscountInput): Promise<Discount> {
  const normalized = normalizeCode(input.code);
  if (!normalized) {
    throw new HTTPException(400, { message: 'Invalid discount code format' });
  }

  const active = input.active ?? true;
  let stripeCouponId: string | null = null;

  if (input.type === 'PERCENTAGE' || input.type === 'FIXED') {
    try {
      const couponParams: Stripe.CouponCreateParams = {
        duration: 'once',
        name: normalized,
        metadata: { code: normalized },
        ...(input.maxRedemptions != null ? { max_redemptions: input.maxRedemptions } : {}),
        ...(input.validUntil != null
          ? { redeem_by: Math.floor(input.validUntil.getTime() / 1000) }
          : {}),
      };
      if (input.type === 'PERCENTAGE') {
        couponParams.percent_off = input.value;
      } else {
        couponParams.amount_off = input.value;
        couponParams.currency = 'cad';
      }
      const coupon = await stripe.coupons.create(couponParams);
      stripeCouponId = coupon.id;
    } catch {
      console.warn('[discount] Stripe coupon creation rejected', { type: input.type });
      throw new StripeCouponRejectedError();
    }
  }

  try {
    return await prisma.discount.create({
      data: {
        code: normalized,
        type: input.type,
        value: input.value,
        minCartCents: input.minCartCents ?? undefined,
        maxRedemptions: input.maxRedemptions ?? undefined,
        validFrom: input.validFrom ?? undefined,
        validUntil: input.validUntil ?? undefined,
        active,
        stripeCouponId,
      },
    });
  } catch (e) {
    if (stripeCouponId) {
      console.error(
        '[discount_orphan_stripe_coupon]',
        JSON.stringify({ stripeCouponId, reason: 'local_insert_failed' }),
      );
    }
    throw e;
  }
}

export async function listDiscounts(input: {
  page: number;
  limit: number;
  active?: boolean;
}): Promise<{
  data: Discount[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  const { page, limit, active } = input;
  const where = active === undefined ? {} : { active };
  const skip = (page - 1) * limit;

  const [total, data] = await prisma.$transaction([
    prisma.discount.count({ where }),
    prisma.discount.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
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
