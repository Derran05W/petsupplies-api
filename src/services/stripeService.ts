import { HTTPException } from 'hono/http-exception';
import Stripe from 'stripe';
import type { SubscriptionInterval } from '@prisma/client';
import { verifySelectionToken } from '../lib/shippingSelection.js';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import type { CheckoutShippingSelection } from '../schemas/shipping.js';
import { env } from '../types/env.js';
import type { ShippingSelectionPayload } from '../types/shipping.js';
import * as discountService from './discountService.js';
import { cartFingerprintFromItems, resolveDestinationPostal } from './shippingService.js';

const SUBSCRIBE_SAVE_COUPON_ID = 'subscribe-save-5pct';

let subscribeSaveCouponPromise: Promise<Stripe.Coupon> | null = null;

/** Test helper — resets cached Subscribe & Save coupon promise between Vitest cases. */
export function resetSubscribeAndSaveCouponCacheForTests(): void {
  subscribeSaveCouponPromise = null;
}

export async function getOrCreateSubscribeAndSaveCoupon(): Promise<Stripe.Coupon> {
  if (!subscribeSaveCouponPromise) {
    subscribeSaveCouponPromise = (async () => {
      try {
        return await stripe.coupons.retrieve(SUBSCRIBE_SAVE_COUPON_ID);
      } catch (e: unknown) {
        if (e instanceof Stripe.errors.StripeInvalidRequestError && e.code === 'resource_missing') {
          return await stripe.coupons.create({
            id: SUBSCRIBE_SAVE_COUPON_ID,
            percent_off: 5,
            duration: 'forever',
            name: 'Subscribe & Save 5%',
          });
        }
        throw e;
      }
    })();
  }
  return subscribeSaveCouponPromise;
}

export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true, email: true },
  });
  if (!user) {
    throw new HTTPException(404, { message: 'USER_NOT_FOUND' });
  }
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }
  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { userId },
  });
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customer.id },
    });
  } catch (e) {
    console.error(
      '[stripe_customer_persist_failed]',
      JSON.stringify({ userId, op: 'getOrCreateStripeCustomer' }),
    );
    throw e;
  }
  return customer.id;
}

export function intervalToStripeRecurring(interval: SubscriptionInterval): {
  interval: 'week';
  interval_count: number;
} {
  const counts: Record<SubscriptionInterval, number> = {
    WEEK_2: 2,
    WEEK_4: 4,
    WEEK_8: 8,
    WEEK_12: 12,
  };
  return { interval: 'week', interval_count: counts[interval] };
}

export async function createSubscriptionCheckoutSession(params: {
  userId: string;
  stripePriceId: string;
  quantity: number;
  subtotalCents: number;
  metadata: Record<string, string>;
}): Promise<{ url: string; checkoutSessionId: string }> {
  const customerId = await getOrCreateStripeCustomer(params.userId);
  await getOrCreateSubscribeAndSaveCoupon();

  const deliveryEstimate = {
    minimum: { unit: 'business_day' as const, value: 5 },
    maximum: { unit: 'business_day' as const, value: 7 },
  };

  const useFreeShippingOption = params.subtotalCents >= env.FREE_SHIPPING_THRESHOLD_CENTS;

  const shippingOptions = useFreeShippingOption
    ? [
        {
          shipping_rate_data: {
            type: 'fixed_amount' as const,
            fixed_amount: { amount: 0, currency: 'cad' as const },
            display_name: 'Free shipping',
            delivery_estimate: deliveryEstimate,
            tax_behavior: 'exclusive' as const,
          },
        },
      ]
    : [
        {
          shipping_rate_data: {
            type: 'fixed_amount' as const,
            fixed_amount: { amount: env.FLAT_SHIPPING_CENTS, currency: 'cad' as const },
            display_name: 'Standard shipping',
            delivery_estimate: deliveryEstimate,
            tax_behavior: 'exclusive' as const,
          },
        },
      ];

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: params.stripePriceId, quantity: params.quantity }],
    discounts: [{ coupon: SUBSCRIBE_SAVE_COUPON_ID }],
    subscription_data: { metadata: params.metadata },
    metadata: params.metadata,
    shipping_address_collection: { allowed_countries: ['CA'] },
    shipping_options: shippingOptions,
    automatic_tax: { enabled: true },
    client_reference_id: params.userId,
    success_url: `${env.FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.FRONTEND_URL}/checkout/cancel`,
  });

  if (!session.url) {
    throw new HTTPException(500, { message: 'Failed to create checkout session URL' });
  }

  return { url: session.url, checkoutSessionId: session.id };
}

export async function ensureStripeSubscriptionProductId(params: {
  productId: string;
  productName: string;
  existingStripePriceId?: string | null;
}): Promise<string> {
  if (params.existingStripePriceId) {
    const price = await stripe.prices.retrieve(params.existingStripePriceId);
    const prod = price.product;
    return typeof prod === 'string' ? prod : prod.id;
  }
  const created = await stripe.products.create({
    name: params.productName,
    metadata: { productId: params.productId },
  });
  return created.id;
}

export async function createStripeRecurringPrice(params: {
  stripeProductId: string;
  unitAmountCents: number;
  interval: SubscriptionInterval;
  productId: string;
}): Promise<string> {
  const rec = intervalToStripeRecurring(params.interval);
  const price = await stripe.prices.create({
    currency: 'cad',
    unit_amount: params.unitAmountCents,
    recurring: { interval: rec.interval, interval_count: rec.interval_count },
    product: params.stripeProductId,
    metadata: { productId: params.productId, interval: params.interval },
  });
  return price.id;
}

export async function stripePauseSubscription(stripeSubscriptionId: string): Promise<void> {
  await stripe.subscriptions.update(stripeSubscriptionId, {
    pause_collection: { behavior: 'void' },
  });
}

export async function stripeResumeSubscription(stripeSubscriptionId: string): Promise<void> {
  await stripe.subscriptions.update(stripeSubscriptionId, {
    pause_collection: '',
  });
}

export async function stripeCancelSubscriptionAtPeriodEnd(
  stripeSubscriptionId: string,
): Promise<void> {
  await stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
}

export async function stripeCancelSubscriptionImmediately(
  stripeSubscriptionId: string,
): Promise<void> {
  await stripe.subscriptions.cancel(stripeSubscriptionId);
}

export async function stripeUpdateSubscriptionItemsProrationNone(params: {
  stripeSubscriptionId: string;
  stripePriceId?: string;
  quantity?: number;
}): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) {
    throw new HTTPException(500, { message: 'SUBSCRIPTION_ITEM_MISSING' });
  }

  await stripe.subscriptions.update(params.stripeSubscriptionId, {
    items: [
      {
        id: itemId,
        ...(params.quantity !== undefined ? { quantity: params.quantity } : {}),
        ...(params.stripePriceId !== undefined ? { price: params.stripePriceId } : {}),
      },
    ],
    proration_behavior: 'none',
  });
}

function checkoutShippingStale(): HTTPException {
  return new HTTPException(409, { message: 'SHIPPING_RATE_STALE' });
}

export async function createCheckoutSessionFromCart(
  userId: string,
  shippingSelection?: CheckoutShippingSelection,
): Promise<{ url: string; orderId: string }> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      discount: true,
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              price: true,
              imageUrl: true,
              stock: true,
              active: true,
            },
          },
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    throw new HTTPException(400, { message: 'Cart is empty' });
  }

  const items = cart.items;

  for (const item of items) {
    if (!item.product.active) {
      throw new HTTPException(409, { message: 'Product no longer available' });
    }
    if (item.product.stock < item.quantity) {
      throw new HTTPException(409, {
        message: `Insufficient stock for ${item.product.name}`,
      });
    }
  }

  const subtotalCents = items.reduce((s, i) => s + i.quantity * i.product.price, 0);

  let discountPreview: discountService.DiscountPreview | null = null;
  if (cart.discountId) {
    const v = await discountService.validateById(cart.discountId, userId, subtotalCents);
    if (!v.ok) {
      throw new HTTPException(409, { message: 'Discount is no longer valid for this cart' });
    }
    discountPreview = v.discount;
  }

  const discountCents = discountPreview ? discountPreview.discountCents : 0;

  const qualifiesForThresholdFreeShip = subtotalCents >= env.FREE_SHIPPING_THRESHOLD_CENTS;
  const useFreeShippingOption =
    qualifiesForThresholdFreeShip || discountPreview?.type === 'FREE_SHIPPING';

  let verifiedSelection: ShippingSelectionPayload | null = null;

  if (shippingSelection) {
    const destPostal = await resolveDestinationPostal(userId, {
      addressId: shippingSelection.addressId,
      line1: shippingSelection.line1,
      line2: shippingSelection.line2,
      city: shippingSelection.city,
      region: shippingSelection.region,
      postalCode: shippingSelection.postalCode,
      country: shippingSelection.country,
    });

    const verified = verifySelectionToken(
      env.STRIPE_WEBHOOK_SECRET,
      shippingSelection.selectionToken,
    );
    if (!verified.ok) {
      throw checkoutShippingStale();
    }
    const { payload } = verified;
    if (payload.userId !== userId) {
      throw checkoutShippingStale();
    }
    if (payload.destPostalCode !== destPostal) {
      throw checkoutShippingStale();
    }
    if (
      payload.serviceCode !== shippingSelection.serviceCode ||
      payload.amountCents !== shippingSelection.amountCents
    ) {
      throw checkoutShippingStale();
    }

    const fp = cartFingerprintFromItems(
      items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
    );
    if (payload.cartFingerprint !== fp) {
      throw checkoutShippingStale();
    }

    if (useFreeShippingOption && payload.amountCents !== 0) {
      throw checkoutShippingStale();
    }

    verifiedSelection = payload;
  }

  const shippingCents = verifiedSelection
    ? verifiedSelection.amountCents
    : useFreeShippingOption
      ? 0
      : env.FLAT_SHIPPING_CENTS;
  const taxCents = 0;
  const totalCents = subtotalCents - discountCents + shippingCents;

  const orderSnapshot =
    verifiedSelection !== null
      ? {
          shipCarrier: verifiedSelection.carrier === 'CANADA_POST' ? 'Canada Post' : 'Flat rate',
          shipServiceCode: verifiedSelection.serviceCode,
          shipServiceName: verifiedSelection.serviceName,
          shipEstimatedDeliveryDays: verifiedSelection.estimatedDeliveryDays ?? null,
          shipQuoteSource: verifiedSelection.shipQuoteSource,
        }
      : {
          shipCarrier: null,
          shipServiceCode: null,
          shipServiceName: null,
          shipEstimatedDeliveryDays: null,
          shipQuoteSource: null,
        };

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        userId,
        status: 'PENDING',
        subtotalCents,
        shippingCents,
        taxCents,
        discountCents,
        totalCents,
        discountId: discountPreview?.discountId ?? null,
        discountCode: discountPreview?.code ?? null,
        discountType: discountPreview?.type ?? null,
        discountValue: discountPreview?.value ?? null,
        ...orderSnapshot,
        items: {
          create: items.map((i) => ({
            productId: i.product.id,
            quantity: i.quantity,
            priceCents: i.product.price,
          })),
        },
      },
    });
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await tx.cart.update({
      where: { id: cart.id },
      data: { discountId: null },
    });
    return created;
  });

  const lineItems = items.map((i) => ({
    quantity: i.quantity,
    price_data: {
      currency: 'cad' as const,
      unit_amount: i.product.price,
      product_data: {
        name: i.product.name,
        images: i.product.imageUrl ? [i.product.imageUrl] : undefined,
        metadata: { productId: i.product.id },
      },
    },
  }));

  const deliveryEstimate =
    verifiedSelection?.estimatedDeliveryDays !== undefined
      ? {
          minimum: {
            unit: 'business_day' as const,
            value: verifiedSelection.estimatedDeliveryDays,
          },
          maximum: {
            unit: 'business_day' as const,
            value: Math.max(verifiedSelection.estimatedDeliveryDays + 2, 7),
          },
        }
      : {
          minimum: { unit: 'business_day' as const, value: 5 },
          maximum: { unit: 'business_day' as const, value: 7 },
        };

  const shippingOptions = verifiedSelection
    ? [
        {
          shipping_rate_data: {
            type: 'fixed_amount' as const,
            fixed_amount: {
              amount: verifiedSelection.amountCents,
              currency: 'cad' as const,
            },
            display_name: verifiedSelection.serviceName,
            delivery_estimate: deliveryEstimate,
            tax_behavior: 'exclusive' as const,
          },
        },
      ]
    : useFreeShippingOption
      ? [
          {
            shipping_rate_data: {
              type: 'fixed_amount' as const,
              fixed_amount: { amount: 0, currency: 'cad' as const },
              display_name: 'Free shipping',
              delivery_estimate: deliveryEstimate,
              tax_behavior: 'exclusive' as const,
            },
          },
        ]
      : [
          {
            shipping_rate_data: {
              type: 'fixed_amount' as const,
              fixed_amount: { amount: env.FLAT_SHIPPING_CENTS, currency: 'cad' as const },
              display_name: 'Standard shipping',
              delivery_estimate: deliveryEstimate,
              tax_behavior: 'exclusive' as const,
            },
          },
        ];

  const metadata: Record<string, string> = { orderId: order.id };
  if (discountPreview?.discountId) {
    metadata.discountId = discountPreview.discountId;
  }

  const customerId = await getOrCreateStripeCustomer(userId);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    customer: customerId,
    line_items: lineItems,
    shipping_options: shippingOptions,
    shipping_address_collection: { allowed_countries: ['CA'] },
    automatic_tax: { enabled: true },
    client_reference_id: userId,
    metadata,
    payment_intent_data: { metadata },
    success_url: `${env.FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.FRONTEND_URL}/checkout/cancel`,
  };

  if (
    discountPreview &&
    (discountPreview.type === 'PERCENTAGE' || discountPreview.type === 'FIXED')
  ) {
    if (!discountPreview.stripeCouponId) {
      throw new HTTPException(500, { message: 'Discount is missing Stripe coupon linkage' });
    }
    sessionParams.discounts = [{ coupon: discountPreview.stripeCouponId }];
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  await prisma.order.update({
    where: { id: order.id },
    data: { stripeSessionId: session.id },
  });

  if (!session.url) {
    throw new HTTPException(500, { message: 'Failed to create checkout session URL' });
  }

  return { url: session.url, orderId: order.id };
}
