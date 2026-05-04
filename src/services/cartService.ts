import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';
import { env } from '../types/env.js';

async function getOrCreateCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function getCart(userId: string) {
  const cart = await getOrCreateCart(userId);
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
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
    orderBy: { createdAt: 'asc' },
  });

  const subtotalCents = items.reduce((sum, it) => sum + it.quantity * it.product.price, 0);
  const freeShippingThresholdCents = env.FREE_SHIPPING_THRESHOLD_CENTS;
  const freeShippingRemainingCents = Math.max(0, freeShippingThresholdCents - subtotalCents);

  return {
    id: cart.id,
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId,
      quantity: it.quantity,
      product: it.product,
    })),
    subtotalCents,
    freeShippingThresholdCents,
    freeShippingRemainingCents,
  };
}

export async function addItem(
  userId: string,
  { productId, quantity }: { productId: string; quantity: number },
) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || !product.active) {
    throw new HTTPException(400, { message: 'Product not found or inactive' });
  }

  const cart = await getOrCreateCart(userId);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId } },
  });
  const newQuantity = (existing?.quantity ?? 0) + quantity;

  if (product.stock < newQuantity) {
    throw new HTTPException(409, { message: 'Insufficient stock' });
  }

  return prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    create: { cartId: cart.id, productId, quantity },
    update: { quantity: newQuantity },
  });
}

export async function updateItem(userId: string, itemId: string, quantity: number) {
  const cart = await getOrCreateCart(userId);
  const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new HTTPException(404, { message: 'Cart item not found' });
  }
  if (item.cartId !== cart.id) {
    throw new HTTPException(403, { message: 'Forbidden' });
  }

  if (quantity === 0) {
    await prisma.cartItem.delete({ where: { id: itemId } });
    return null;
  }

  const product = await prisma.product.findUnique({
    where: { id: item.productId },
  });
  if (!product || !product.active) {
    throw new HTTPException(400, { message: 'Product not found or inactive' });
  }
  if (product.stock < quantity) {
    throw new HTTPException(409, { message: 'Insufficient stock' });
  }

  return prisma.cartItem.update({
    where: { id: itemId },
    data: { quantity },
  });
}

export async function removeItem(userId: string, itemId: string) {
  const cart = await getOrCreateCart(userId);
  const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new HTTPException(404, { message: 'Cart item not found' });
  }
  if (item.cartId !== cart.id) {
    throw new HTTPException(403, { message: 'Forbidden' });
  }
  await prisma.cartItem.delete({ where: { id: itemId } });
}

export async function clear(userId: string) {
  const cart = await prisma.cart.findUnique({ where: { userId } });
  if (!cart) return;
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
}
