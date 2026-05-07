import { HTTPException } from 'hono/http-exception';
import type Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { env } from '../types/env.js';
import * as discountService from './discountService.js';

export async function createCheckoutSessionFromCart(
  userId: string,
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

  const shippingCents = useFreeShippingOption ? 0 : env.FLAT_SHIPPING_CENTS;
  const taxCents = 0;
  const totalCents = subtotalCents - discountCents + shippingCents;

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

  const deliveryEstimate = {
    minimum: { unit: 'business_day' as const, value: 5 },
    maximum: { unit: 'business_day' as const, value: 7 },
  };

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

  const metadata: Record<string, string> = { orderId: order.id };
  if (discountPreview?.discountId) {
    metadata.discountId = discountPreview.discountId;
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
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
