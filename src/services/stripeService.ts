import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { env } from '../types/env.js';

export async function createCheckoutSessionFromCart(
  userId: string,
): Promise<{ url: string; orderId: string }> {
  // 1. Load cart with product include
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
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

  // 2. Empty cart check
  if (!cart || cart.items.length === 0) {
    throw new HTTPException(400, { message: 'Cart is empty' });
  }

  const items = cart.items;

  // 3. Validate every item
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

  // 4. Compute subtotal
  const subtotalCents = items.reduce((s, i) => s + i.quantity * i.product.price, 0);

  // 5. Create order + items + clear cart atomically
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        userId,
        status: 'PENDING',
        totalCents: subtotalCents,
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
    return created;
  });

  // 6. Build Stripe line_items
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

  // 7. Build shipping_options
  const deliveryEstimate = {
    minimum: { unit: 'business_day' as const, value: 5 },
    maximum: { unit: 'business_day' as const, value: 7 },
  };

  const shippingOptions =
    subtotalCents >= env.FREE_SHIPPING_THRESHOLD_CENTS
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

  // 8. Create the Stripe session
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    shipping_options: shippingOptions,
    shipping_address_collection: { allowed_countries: ['CA'] },
    automatic_tax: { enabled: true },
    client_reference_id: userId,
    metadata: { orderId: order.id },
    success_url: `${env.FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.FRONTEND_URL}/checkout/cancel`,
  });

  // 9. Persist sessionId on order (after transaction — Stripe call must complete first)
  await prisma.order.update({
    where: { id: order.id },
    data: { stripeSessionId: session.id },
  });

  // 10. Return url + orderId
  if (!session.url) {
    throw new HTTPException(500, { message: 'Failed to create checkout session URL' });
  }

  return { url: session.url, orderId: order.id };
}
