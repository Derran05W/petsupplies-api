import type {
  Prisma,
  ProductSubscriptionPrice,
  Subscription as DbSubscription,
  SubscriptionInterval,
  SubscriptionStatus,
} from '@prisma/client';
import Stripe from 'stripe';
import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';
import * as stripeService from './stripeService.js';
import {
  sendOrderConfirmation,
  sendSubscriptionPaymentIssue,
  sendUpcomingDeliveryReminder,
} from './emailService.js';
import { onProductBecameOutOfStock } from './stockAlertService.js';
import { env } from '../types/env.js';

/** Snake_case subscription payloads from Stripe webhooks / REST (explicit shape avoids Prisma `Subscription` name clashes). */
export interface StripeSubscriptionPayload {
  id: string;
  metadata: Record<string, string> | null | undefined;
  items: {
    data: Array<{
      quantity?: number | null;
      price?: string | { id?: string | null } | null;
    }>;
  };
  status: string;
  canceled_at: number | null;
  pause_collection: unknown | null;
  current_period_end: number;
}

function stripeSubscriptionFromUnknown(raw: unknown): StripeSubscriptionPayload {
  return raw as StripeSubscriptionPayload;
}

type StripeInvoiceWithRelations = Stripe.Invoice & {
  subscription?: string | { id?: string } | null;
  payment_intent?: string | { id?: string } | null;
};

function stripeInvoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const inv = invoice as StripeInvoiceWithRelations;
  const s = inv.subscription;
  return typeof s === 'string' ? s : s?.id;
}

function stripeInvoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as StripeInvoiceWithRelations;
  const pi = inv.payment_intent;
  if (typeof pi === 'string') return pi;
  if (typeof pi === 'object' && pi !== null && 'id' in pi) {
    const id = (pi as { id?: string }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

export const MAX_ACTIVE_SUBSCRIPTIONS_PER_USER = 25;

export interface CreateSubscriptionInput {
  productId: string;
  quantity: number;
  interval: SubscriptionInterval;
  petId?: string | null;
}

export interface CreateSubscriptionResult {
  url: string;
  checkoutSessionId: string;
}

export interface ListSubscriptionsInput {
  page: number;
  limit: number;
  status?: SubscriptionStatus;
}

export interface UpdateSubscriptionInput {
  quantity?: number;
  interval?: SubscriptionInterval;
  petId?: string | null;
}

export interface CancelSubscriptionInput {
  immediate?: boolean;
}

export interface PaginatedSubscriptions {
  data: SubscriptionPublic[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SubscriptionPublic {
  id: string;
  userId: string;
  productId: string;
  product: {
    id: string;
    slug: string;
    name: string;
    imageUrl: string | null;
    price: number;
  };
  petId: string | null;
  pet: {
    id: string;
    name: string;
    species: string;
  } | null;
  quantity: number;
  interval: SubscriptionInterval;
  status: SubscriptionStatus;
  discountPercent: number;
  nextDeliveryAt: Date;
  pausedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplyInvoiceToOrderResult {
  orderId: string;
  created: boolean;
  status: 'PAID' | 'CANCELLED';
  reason?: 'ALREADY_PROCESSED' | 'OVERSOLD' | 'SUBSCRIPTION_NOT_FOUND';
}

const subscriptionInclude = {
  product: {
    select: { id: true, slug: true, name: true, imageUrl: true, price: true },
  },
  pet: {
    select: { id: true, name: true, species: true },
  },
} as const;

type SubscriptionLoaded = Prisma.SubscriptionGetPayload<{ include: typeof subscriptionInclude }>;

function paginate(page: number, limit: number): { skip: number; take: number } {
  return { skip: (page - 1) * limit, take: limit };
}

function totalPages(total: number, limit: number): number {
  return Math.ceil(total / limit) || 0;
}

function toPublic(row: SubscriptionLoaded): SubscriptionPublic {
  return {
    id: row.id,
    userId: row.userId,
    productId: row.productId,
    product: row.product,
    petId: row.petId,
    pet: row.pet,
    quantity: row.quantity,
    interval: row.interval,
    status: row.status,
    discountPercent: row.discountPercent,
    nextDeliveryAt: row.nextDeliveryAt,
    pausedAt: row.pausedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parsePositiveMetadataInt(raw: string | undefined | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseSubscriptionInterval(raw: string | undefined | null): SubscriptionInterval | null {
  if (raw === 'WEEK_2' || raw === 'WEEK_4' || raw === 'WEEK_8' || raw === 'WEEK_12') {
    return raw;
  }
  return null;
}

async function resolveIntervalForStripePrice(
  stripePriceId: string,
  metadataInterval?: string | null,
): Promise<SubscriptionInterval | null> {
  const row = await prisma.productSubscriptionPrice.findFirst({
    where: { stripePriceId, active: true },
    select: { interval: true },
  });
  if (row) return row.interval;
  return parseSubscriptionInterval(metadataInterval ?? null);
}

function mapStripePauseAndCancel(stripeSub: StripeSubscriptionPayload): {
  status: SubscriptionStatus;
  pausedAt: Date | null;
  cancelledAt: Date | null;
} {
  if (stripeSub.status === 'canceled') {
    const cancelledAt = stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : new Date();
    return { status: 'CANCELLED', pausedAt: null, cancelledAt };
  }

  if (stripeSub.pause_collection != null) {
    return { status: 'PAUSED', pausedAt: new Date(), cancelledAt: null };
  }

  return { status: 'ACTIVE', pausedAt: null, cancelledAt: null };
}

export async function syncSubscriptionFromStripe(
  stripeSubInput: unknown,
): Promise<DbSubscription | null> {
  const stripeSub = stripeSubscriptionFromUnknown(stripeSubInput);
  const md = stripeSub.metadata ?? {};
  const userId = md.userId;
  const productId = md.productId;
  if (!userId || !productId) {
    console.warn(
      '[webhook] subscription sync skipped — metadata incomplete',
      JSON.stringify({
        op: 'syncSubscriptionFromStripe',
        stripeEventType: 'subscription.sync',
      }),
    );
    return null;
  }

  const item = stripeSub.items.data[0];
  const stripePriceId = typeof item?.price === 'string' ? item.price : (item?.price?.id ?? null);
  if (!stripePriceId) {
    console.warn(
      '[webhook] subscription sync skipped — missing price',
      JSON.stringify({
        op: 'syncSubscriptionFromStripe',
        stripeEventType: 'subscription.sync',
        userId,
        productId,
      }),
    );
    return null;
  }

  const quantity = item?.quantity ?? parsePositiveMetadataInt(md.quantity, 1);
  const intervalResolved = await resolveIntervalForStripePrice(stripePriceId, md.interval);
  if (!intervalResolved) {
    console.warn(
      '[webhook] subscription sync skipped — unknown interval',
      JSON.stringify({
        op: 'syncSubscriptionFromStripe',
        stripeEventType: 'subscription.sync',
        userId,
        productId,
      }),
    );
    return null;
  }

  const discountPercent = parsePositiveMetadataInt(md.discountPercent, 5);
  const petKeyPresent = Object.prototype.hasOwnProperty.call(md, 'petId');
  const petIdRaw = md.petId?.trim();
  const petIdForCreate = petIdRaw ? petIdRaw : null;

  const periodEnd = stripeSub.current_period_end;
  if (!periodEnd) {
    console.warn(
      '[webhook] subscription sync skipped — missing period end',
      JSON.stringify({
        op: 'syncSubscriptionFromStripe',
        stripeEventType: 'subscription.sync',
        userId,
        productId,
      }),
    );
    return null;
  }

  const nextDeliveryAt = new Date(periodEnd * 1000);
  const mapped = mapStripePauseAndCancel(stripeSub);

  const upserted = await prisma.subscription.upsert({
    where: { stripeSubscriptionId: stripeSub.id },
    create: {
      userId,
      productId,
      petId: petIdForCreate,
      quantity,
      interval: intervalResolved,
      discountPercent,
      nextDeliveryAt,
      stripeSubscriptionId: stripeSub.id,
      stripePriceId,
      status: mapped.status,
      pausedAt: mapped.pausedAt,
      cancelledAt: mapped.cancelledAt,
    },
    update: {
      quantity,
      interval: intervalResolved,
      stripePriceId,
      discountPercent,
      nextDeliveryAt,
      status: mapped.status,
      pausedAt: mapped.pausedAt,
      cancelledAt: mapped.cancelledAt,
      ...(petKeyPresent ? { petId: petIdForCreate } : {}),
    },
  });

  console.info(
    JSON.stringify({
      subscriptionId: upserted.id,
      userId,
      productId,
      op: 'syncSubscriptionFromStripe',
      stripeEventType: 'subscription.sync',
    }),
  );

  return upserted;
}

export async function createSubscription(
  userId: string,
  input: CreateSubscriptionInput,
): Promise<CreateSubscriptionResult> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    select: { discountId: true },
  });
  if (cart?.discountId) {
    throw new HTTPException(409, { message: 'DISCOUNT_STACKING_NOT_ALLOWED' });
  }

  const activeCount = await prisma.subscription.count({
    where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } },
  });
  if (activeCount >= MAX_ACTIVE_SUBSCRIPTIONS_PER_USER) {
    throw new HTTPException(400, { message: 'SUBSCRIPTIONS_LIMIT_REACHED' });
  }

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      active: true,
      subscriptionEligible: true,
      price: true,
      stock: true,
    },
  });
  if (!product) {
    throw new HTTPException(404, { message: 'PRODUCT_NOT_FOUND' });
  }
  if (!product.active) {
    throw new HTTPException(400, { message: 'PRODUCT_NOT_ACTIVE' });
  }
  if (!product.subscriptionEligible) {
    throw new HTTPException(409, { message: 'PRODUCT_NOT_SUBSCRIPTION_ELIGIBLE' });
  }

  const priceRow = await prisma.productSubscriptionPrice.findFirst({
    where: {
      productId: input.productId,
      interval: input.interval,
      active: true,
    },
  });
  if (!priceRow) {
    throw new HTTPException(409, { message: 'SUBSCRIPTION_PRICE_MISSING' });
  }

  if (product.stock < input.quantity) {
    throw new HTTPException(409, { message: 'INSUFFICIENT_STOCK' });
  }

  let petId: string | null | undefined;
  if (input.petId !== undefined && input.petId !== null) {
    const pet = await prisma.pet.findFirst({
      where: { id: input.petId, userId },
      select: { id: true },
    });
    if (!pet) {
      throw new HTTPException(404, { message: 'PET_NOT_FOUND' });
    }
    petId = pet.id;
  } else {
    petId = undefined;
  }

  const metadata: Record<string, string> = {
    userId,
    productId: product.id,
    quantity: String(input.quantity),
    interval: input.interval,
    discountPercent: String(5),
  };
  if (petId) {
    metadata.petId = petId;
  }

  const subtotalCents = product.price * input.quantity;

  const session = await stripeService.createSubscriptionCheckoutSession({
    userId,
    stripePriceId: priceRow.stripePriceId,
    quantity: input.quantity,
    subtotalCents,
    metadata,
  });

  console.info(
    JSON.stringify({
      userId,
      productId: product.id,
      op: 'createSubscription',
      stripeEventType: 'checkout.session.create',
    }),
  );

  return {
    url: session.url,
    checkoutSessionId: session.checkoutSessionId,
  };
}

export async function listSubscriptions(
  userId: string,
  input: ListSubscriptionsInput,
): Promise<PaginatedSubscriptions> {
  const page = Math.max(1, input.page <= 0 ? 1 : input.page);
  const rawLimit = input.limit <= 0 ? 20 : input.limit;
  const limit = Math.min(100, Math.max(1, rawLimit));
  const where: Prisma.SubscriptionWhereInput = {
    userId,
    ...(input.status ? { status: input.status } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(page, limit),
      include: subscriptionInclude,
    }),
  ]);

  return {
    data: rows.map(toPublic),
    page,
    limit,
    total,
    totalPages: totalPages(total, limit),
  };
}

export async function getSubscription(
  userId: string,
  subscriptionId: string,
): Promise<SubscriptionPublic | null> {
  const row = await prisma.subscription.findFirst({
    where: { id: subscriptionId, userId },
    include: subscriptionInclude,
  });
  return row ? toPublic(row) : null;
}

const UPDATABLE: (keyof UpdateSubscriptionInput)[] = ['quantity', 'interval', 'petId'];

export async function updateSubscription(
  userId: string,
  subscriptionId: string,
  input: UpdateSubscriptionInput,
): Promise<SubscriptionPublic | null> {
  const touched = UPDATABLE.filter((k) => input[k] !== undefined);
  if (touched.length === 0) {
    throw new HTTPException(400, { message: 'EMPTY_PATCH' });
  }

  const existing = await prisma.subscription.findFirst({
    where: { id: subscriptionId, userId },
    select: {
      id: true,
      stripeSubscriptionId: true,
      productId: true,
      stripePriceId: true,
    },
  });
  if (!existing) {
    return null;
  }

  let nextStripePriceId: string | undefined;
  let nextPetId: string | null | undefined;

  if (input.interval !== undefined) {
    const pr = await prisma.productSubscriptionPrice.findFirst({
      where: {
        productId: existing.productId,
        interval: input.interval,
        active: true,
      },
    });
    if (!pr) {
      throw new HTTPException(409, { message: 'SUBSCRIPTION_PRICE_MISSING' });
    }
    nextStripePriceId = pr.stripePriceId;
  }

  if (input.petId !== undefined) {
    if (input.petId === null) {
      nextPetId = null;
    } else {
      const pet = await prisma.pet.findFirst({
        where: { id: input.petId, userId },
        select: { id: true },
      });
      if (!pet) {
        throw new HTTPException(404, { message: 'PET_NOT_FOUND' });
      }
      nextPetId = pet.id;
    }
  }

  await stripeService.stripeUpdateSubscriptionItemsProrationNone({
    stripeSubscriptionId: existing.stripeSubscriptionId,
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    ...(nextStripePriceId !== undefined ? { stripePriceId: nextStripePriceId } : {}),
  });

  const updated = await prisma.subscription.updateMany({
    where: { id: subscriptionId, userId },
    data: {
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.interval !== undefined && nextStripePriceId
        ? { interval: input.interval, stripePriceId: nextStripePriceId }
        : {}),
      ...(input.petId !== undefined ? { petId: nextPetId ?? null } : {}),
    } as Prisma.SubscriptionUncheckedUpdateManyInput,
  });
  if (updated.count === 0) {
    return null;
  }

  console.info(
    JSON.stringify({
      subscriptionId,
      userId,
      productId: existing.productId,
      op: 'updateSubscription',
      stripeEventType: 'subscriptions.update',
    }),
  );

  return getSubscription(userId, subscriptionId);
}

export async function pauseSubscription(
  userId: string,
  subscriptionId: string,
): Promise<SubscriptionPublic | null> {
  const row = await prisma.subscription.findFirst({
    where: { id: subscriptionId, userId },
    select: {
      id: true,
      stripeSubscriptionId: true,
      status: true,
      userId: true,
      productId: true,
    },
  });
  if (!row) return null;
  if (row.status === 'CANCELLED' || row.status === 'PAUSED') {
    throw new HTTPException(409, { message: 'INVALID_SUBSCRIPTION_STATE' });
  }

  await stripeService.stripePauseSubscription(row.stripeSubscriptionId);

  console.info(
    JSON.stringify({
      subscriptionId: row.id,
      userId,
      productId: row.productId,
      op: 'pauseSubscription',
      stripeEventType: 'subscriptions.update',
    }),
  );

  return getSubscription(userId, subscriptionId);
}

export async function resumeSubscription(
  userId: string,
  subscriptionId: string,
): Promise<SubscriptionPublic | null> {
  const row = await prisma.subscription.findFirst({
    where: { id: subscriptionId, userId },
    select: {
      id: true,
      stripeSubscriptionId: true,
      status: true,
      userId: true,
      productId: true,
    },
  });
  if (!row) return null;
  if (row.status !== 'PAUSED') {
    throw new HTTPException(409, { message: 'INVALID_SUBSCRIPTION_STATE' });
  }

  await stripeService.stripeResumeSubscription(row.stripeSubscriptionId);

  console.info(
    JSON.stringify({
      subscriptionId: row.id,
      userId,
      productId: row.productId,
      op: 'resumeSubscription',
      stripeEventType: 'subscriptions.update',
    }),
  );

  return getSubscription(userId, subscriptionId);
}

export async function cancelSubscription(
  userId: string,
  subscriptionId: string,
  input?: CancelSubscriptionInput,
): Promise<SubscriptionPublic | null> {
  const row = await prisma.subscription.findFirst({
    where: { id: subscriptionId, userId },
    select: {
      id: true,
      stripeSubscriptionId: true,
      status: true,
      userId: true,
      productId: true,
    },
  });
  if (!row) return null;
  if (row.status === 'CANCELLED') {
    throw new HTTPException(409, { message: 'INVALID_SUBSCRIPTION_STATE' });
  }

  if (input?.immediate) {
    await stripeService.stripeCancelSubscriptionImmediately(row.stripeSubscriptionId);
  } else {
    await stripeService.stripeCancelSubscriptionAtPeriodEnd(row.stripeSubscriptionId);
  }

  console.info(
    JSON.stringify({
      subscriptionId: row.id,
      userId,
      productId: row.productId,
      op: 'cancelSubscription',
      stripeEventType: 'subscriptions.update',
    }),
  );

  return getSubscription(userId, subscriptionId);
}

export async function markProductSubscriptionEligible(productId: string): Promise<{
  productId: string;
  subscriptionEligible: true;
  prices: ProductSubscriptionPrice[];
}> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, price: true },
  });
  if (!product) {
    throw new HTTPException(404, { message: 'PRODUCT_NOT_FOUND' });
  }

  const intervals: SubscriptionInterval[] = ['WEEK_2', 'WEEK_4', 'WEEK_8', 'WEEK_12'];

  const existingRows = await prisma.productSubscriptionPrice.findMany({
    where: { productId },
  });

  const firstExistingPriceId = existingRows.find((r) => r.active)?.stripePriceId ?? null;

  const stripeProductId = await stripeService.ensureStripeSubscriptionProductId({
    productId: product.id,
    productName: product.name,
    existingStripePriceId: firstExistingPriceId,
  });

  for (const interval of intervals) {
    const current = existingRows.find((r) => r.interval === interval);
    if (current?.active) {
      continue;
    }

    const stripePriceId = await stripeService.createStripeRecurringPrice({
      stripeProductId,
      unitAmountCents: product.price,
      interval,
      productId: product.id,
    });

    try {
      await prisma.productSubscriptionPrice.upsert({
        where: {
          productId_interval: { productId: product.id, interval },
        },
        create: {
          productId: product.id,
          interval,
          stripePriceId,
          active: true,
        },
        update: {
          stripePriceId,
          active: true,
        },
      });
    } catch (e) {
      console.error(
        '[subscription_price_orphan_stripe]',
        JSON.stringify({
          productId: product.id,
          op: 'markProductSubscriptionEligible',
          stripeEventType: 'prices.create',
        }),
      );
      throw e;
    }
  }

  await prisma.product.update({
    where: { id: productId },
    data: { subscriptionEligible: true },
  });

  const prices = await prisma.productSubscriptionPrice.findMany({
    where: { productId },
    orderBy: { interval: 'asc' },
  });

  return {
    productId,
    subscriptionEligible: true,
    prices,
  };
}

export async function applyInvoiceToOrder(
  invoice: Stripe.Invoice,
): Promise<ApplyInvoiceToOrderResult> {
  const stripeSubId = stripeInvoiceSubscriptionId(invoice);

  if (!stripeSubId || !invoice.id) {
    return {
      orderId: '',
      created: false,
      status: 'PAID',
      reason: 'SUBSCRIPTION_NOT_FOUND',
    };
  }

  const subscriptionInvoiceId = invoice.id;

  const existingOrder = await prisma.order.findUnique({
    where: { subscriptionInvoiceId },
    select: { id: true, status: true },
  });
  if (existingOrder) {
    return {
      orderId: existingOrder.id,
      created: false,
      status: existingOrder.status === 'CANCELLED' ? 'CANCELLED' : 'PAID',
      reason: 'ALREADY_PROCESSED',
    };
  }

  const localSub = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubId },
    include: {
      product: true,
      user: { select: { email: true, name: true } },
    },
  });

  if (!localSub) {
    console.warn(
      '[webhook] invoice.paid skipped — subscription missing',
      JSON.stringify({
        op: 'applyInvoiceToOrder',
        stripeEventType: 'invoice.paid',
      }),
    );
    return {
      orderId: '',
      created: false,
      status: 'PAID',
      reason: 'SUBSCRIPTION_NOT_FOUND',
    };
  }

  const quantity = localSub.quantity;
  const subtotalCents = localSub.product.price * quantity;

  let discountCents: number;
  let totalCents: number;
  if (typeof invoice.amount_paid === 'number') {
    totalCents = invoice.amount_paid;
    discountCents = Math.max(0, subtotalCents - totalCents);
  } else {
    discountCents = Math.floor((localSub.discountPercent * subtotalCents) / 100);
    totalCents = subtotalCents - discountCents;
  }

  const shippingCents = 0;
  const taxCents = 0;

  const stripePaymentIntent = stripeInvoicePaymentIntentId(invoice);

  let createdOrderId = '';
  let finalizedStatus: 'PAID' | 'CANCELLED' = 'PAID';
  let oversold = false;
  let subscriptionStockBefore: number | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      const dup = await tx.order.findUnique({
        where: { subscriptionInvoiceId },
        select: { id: true },
      });
      if (dup) {
        return;
      }

      const order = await tx.order.create({
        data: {
          userId: localSub.userId,
          status: 'PENDING',
          stripeSessionId: null,
          stripePaymentIntent,
          subscriptionId: localSub.id,
          subscriptionInvoiceId,
          subtotalCents,
          shippingCents,
          taxCents,
          discountCents,
          totalCents,
          items: {
            create: [
              {
                productId: localSub.productId,
                quantity,
                priceCents: localSub.product.price,
              },
            ],
          },
        },
      });
      createdOrderId = order.id;

      const preStock = await tx.product.findUnique({
        where: { id: localSub.productId },
        select: { stock: true },
      });
      subscriptionStockBefore = preStock?.stock ?? 0;

      const dec = await tx.product.updateMany({
        where: { id: localSub.productId, stock: { gte: quantity } },
        data: { stock: { decrement: quantity } },
      });

      if (dec.count === 0) {
        oversold = true;
        finalizedStatus = 'CANCELLED';
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' },
        });
        return;
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'PAID' },
      });
      finalizedStatus = 'PAID';
    });
  } catch (e) {
    const maybeDup =
      e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002';
    if (maybeDup) {
      const row = await prisma.order.findUnique({
        where: { subscriptionInvoiceId },
        select: { id: true, status: true },
      });
      if (row) {
        return {
          orderId: row.id,
          created: false,
          status: row.status === 'CANCELLED' ? 'CANCELLED' : 'PAID',
          reason: 'ALREADY_PROCESSED',
        };
      }
    }
    throw e;
  }

  if (!oversold && subscriptionStockBefore !== null) {
    const afterStock = subscriptionStockBefore - quantity;
    if (subscriptionStockBefore > 0 && afterStock === 0) {
      void onProductBecameOutOfStock(localSub.productId);
    }
  }

  if (!createdOrderId) {
    const row = await prisma.order.findUnique({
      where: { subscriptionInvoiceId },
      select: { id: true, status: true },
    });
    if (row) {
      return {
        orderId: row.id,
        created: false,
        status: row.status === 'CANCELLED' ? 'CANCELLED' : 'PAID',
        reason: 'ALREADY_PROCESSED',
      };
    }
    return {
      orderId: '',
      created: false,
      status: 'PAID',
      reason: 'SUBSCRIPTION_NOT_FOUND',
    };
  }

  if (oversold) {
    console.error(
      '[subscription_oversold_incident]',
      JSON.stringify({
        subscriptionId: localSub.id,
        subscriptionInvoiceId,
        productId: localSub.productId,
        requestedQty: quantity,
      }),
    );

    try {
      const emailResult = await sendSubscriptionPaymentIssue({
        subscriptionId: localSub.id,
        to: localSub.user.email,
        customerName: localSub.user.name,
        invoiceId: subscriptionInvoiceId,
      });
      if (!emailResult.ok) {
        console.warn('[email] subscription payment issue failed', {
          subscriptionId: localSub.id,
          providerMessageId: emailResult.messageId,
          error: emailResult.error,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.warn('[email] subscription payment issue failed', {
        subscriptionId: localSub.id,
        error: message,
      });
    }

    return {
      orderId: createdOrderId,
      created: true,
      status: 'CANCELLED',
      reason: 'OVERSOLD',
    };
  }

  try {
    const fresh = await prisma.order.findUnique({
      where: { id: createdOrderId },
      include: {
        user: { select: { email: true, name: true } },
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });

    if (fresh?.status === 'PAID') {
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
          orderId: fresh.id,
          providerMessageId: result.messageId,
          error: result.error,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.warn('[email] order confirmation failed', {
      template: 'order-confirmation',
      subscriptionId: localSub.id,
      error: message,
    });
  }

  console.info(
    JSON.stringify({
      subscriptionId: localSub.id,
      userId: localSub.userId,
      productId: localSub.productId,
      orderId: createdOrderId,
      op: 'applyInvoiceToOrder',
      stripeEventType: 'invoice.paid',
    }),
  );

  return {
    orderId: createdOrderId,
    created: true,
    status: finalizedStatus,
  };
}

export interface SendUpcomingDeliveryRemindersDueOpts {
  now?: Date;
  windowStartAt?: Date;
  windowEndAt?: Date;
}

export async function sendUpcomingDeliveryRemindersDue(
  arg?: Date | SendUpcomingDeliveryRemindersDueOpts,
): Promise<{ scanned: number; sent: number; failed: number; skipped: number }> {
  let rangeStart: Date;
  let rangeEnd: Date;
  let endExclusive: boolean;

  if (arg === undefined || arg instanceof Date) {
    const anchor = arg ?? new Date();
    rangeStart = anchor;
    rangeEnd = new Date(anchor.getTime() + 24 * 60 * 60 * 1000);
    endExclusive = false;
  } else {
    const { now = new Date(), windowStartAt, windowEndAt } = arg;
    if (windowStartAt !== undefined && windowEndAt !== undefined) {
      rangeStart = windowStartAt;
      rangeEnd = windowEndAt;
      endExclusive = true;
    } else {
      rangeStart = now;
      rangeEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      endExclusive = false;
    }
  }

  const subs = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      nextDeliveryAt: endExclusive
        ? { gte: rangeStart, lt: rangeEnd }
        : { gte: rangeStart, lte: rangeEnd },
    },
    include: {
      product: { select: { id: true, name: true, slug: true } },
      pet: { select: { id: true, name: true } },
      user: { select: { email: true, name: true } },
    },
  });

  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      const deliveryDate = sub.nextDeliveryAt.toISOString().slice(0, 10);
      const result = await sendUpcomingDeliveryReminder({
        subscriptionId: sub.id,
        to: sub.user.email,
        customerName: sub.user.name,
        nextDeliveryAt: sub.nextDeliveryAt,
        productName: sub.product.name,
        productUrl: `${env.FRONTEND_URL}/products/${sub.product.slug}`,
        petName: sub.pet?.name ?? null,
        deliveryDateLabel: deliveryDate,
      });
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
        console.warn(
          JSON.stringify({
            op: 'sendUpcomingDeliveryRemindersDue',
            evt: 'upcoming_delivery_send_failed',
            subscriptionId: sub.id,
            userId: sub.userId,
            code: result.error ?? 'SEND_FAILED',
          }),
        );
      }
    } catch (err) {
      failed += 1;
      const code = err instanceof Error ? err.name : 'EXCEPTION';
      console.warn(
        JSON.stringify({
          op: 'sendUpcomingDeliveryRemindersDue',
          evt: 'upcoming_delivery_send_failed',
          subscriptionId: sub.id,
          userId: sub.userId,
          code,
        }),
      );
    }
  }

  return { scanned: subs.length, sent, failed, skipped: 0 };
}
