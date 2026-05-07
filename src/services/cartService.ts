import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';
import { env } from '../types/env.js';
import type { DiscountRejectReason } from './discountService.js';
import * as discountService from './discountService.js';

type CartItemRow = {
  id: string;
  productId: string;
  quantity: number;
  product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    imageUrl: string | null;
    stock: number;
    active: boolean;
  };
};

export interface CartResponse {
  id: string;
  items: CartItemRow[];
  subtotalCents: number;
  appliedDiscountCents: number;
  shippingCents: number;
  shippingDiscountCents: number;
  totalCents: number;
  discountCode?: string;
  discountType?: 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING';
  discountValue?: number;
  freeShippingThresholdCents: number;
  freeShippingRemainingCents: number;
  discountInvalidReason?: DiscountRejectReason;
  discountInvalidCode?: string;
}

const productSelect = {
  id: true,
  name: true,
  slug: true,
  price: true,
  imageUrl: true,
  stock: true,
  active: true,
} as const;

async function getOrCreateCartRecord(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    include: { discount: true },
  });
}

async function loadCartItems(cartId: string): Promise<CartItemRow[]> {
  const items = await prisma.cartItem.findMany({
    where: { cartId },
    include: {
      product: { select: productSelect },
    },
    orderBy: { createdAt: 'asc' },
  });
  return items.map((it) => ({
    id: it.id,
    productId: it.productId,
    quantity: it.quantity,
    product: it.product,
  }));
}

function subtotalFromItems(items: CartItemRow[]): number {
  return items.reduce((sum, it) => sum + it.quantity * it.product.price, 0);
}

function buildCartPayload(
  cartId: string,
  items: CartItemRow[],
  preview: discountService.DiscountPreview | null,
  extras?: {
    discountInvalidReason?: DiscountRejectReason;
    discountInvalidCode?: string;
  },
): CartResponse {
  const subtotalCents = subtotalFromItems(items);
  const freeShippingThresholdCents = env.FREE_SHIPPING_THRESHOLD_CENTS;
  const freeShippingRemainingCents = Math.max(0, freeShippingThresholdCents - subtotalCents);

  let appliedDiscountCents = 0;
  let shippingDiscountCents = 0;
  let shippingCents = subtotalCents >= freeShippingThresholdCents ? 0 : env.FLAT_SHIPPING_CENTS;

  let discountCode: string | undefined;
  let discountType: CartResponse['discountType'];
  let discountValue: number | undefined;

  if (preview) {
    appliedDiscountCents = preview.discountCents;
    shippingDiscountCents = preview.shippingDiscountCents;
    if (preview.type === 'FREE_SHIPPING') {
      shippingCents = 0;
    }
    discountCode = preview.code;
    discountType = preview.type;
    discountValue = preview.value;
  }

  const totalCents = subtotalCents - appliedDiscountCents + shippingCents;

  return {
    id: cartId,
    items,
    subtotalCents,
    appliedDiscountCents,
    shippingCents,
    shippingDiscountCents,
    totalCents,
    ...(discountCode !== undefined ? { discountCode } : {}),
    ...(discountType !== undefined ? { discountType } : {}),
    ...(discountValue !== undefined ? { discountValue } : {}),
    freeShippingThresholdCents,
    freeShippingRemainingCents,
    ...(extras?.discountInvalidReason !== undefined
      ? { discountInvalidReason: extras.discountInvalidReason }
      : {}),
    ...(extras?.discountInvalidCode !== undefined
      ? { discountInvalidCode: extras.discountInvalidCode }
      : {}),
  };
}

export async function getCart(userId: string): Promise<CartResponse> {
  const cart = await getOrCreateCartRecord(userId);
  const items = await loadCartItems(cart.id);
  const subtotalCents = subtotalFromItems(items);

  if (!cart.discountId) {
    return buildCartPayload(cart.id, items, null);
  }

  if (!cart.discount) {
    await prisma.cart.update({
      where: { id: cart.id },
      data: { discountId: null },
    });
    return buildCartPayload(cart.id, items, null, {
      discountInvalidReason: 'NOT_FOUND',
      discountInvalidCode: '',
    });
  }

  const v = await discountService.validateById(cart.discountId, userId, subtotalCents);
  if (!v.ok) {
    const invalidCode = cart.discount.code;
    await prisma.cart.update({
      where: { id: cart.id },
      data: { discountId: null },
    });
    return buildCartPayload(cart.id, items, null, {
      discountInvalidReason: v.reason,
      discountInvalidCode: invalidCode,
    });
  }

  return buildCartPayload(cart.id, items, v.discount);
}

export type ApplyDiscountResult =
  | { ok: true; cart: CartResponse }
  | { ok: false; reason: DiscountRejectReason };

export async function applyDiscount(userId: string, code: string): Promise<ApplyDiscountResult> {
  const cart = await getOrCreateCartRecord(userId);
  const items = await loadCartItems(cart.id);
  const subtotalCents = subtotalFromItems(items);

  const v = await discountService.validate(code, userId, subtotalCents);
  if (!v.ok) {
    return { ok: false, reason: v.reason };
  }

  await prisma.cart.update({
    where: { id: cart.id },
    data: { discountId: v.discount.discountId },
  });

  const cartPayload = await getCart(userId);
  return { ok: true, cart: cartPayload };
}

export async function removeDiscount(userId: string): Promise<CartResponse> {
  const cart = await prisma.cart.findUnique({ where: { userId } });
  if (cart) {
    await prisma.cart.update({
      where: { id: cart.id },
      data: { discountId: null },
    });
  }
  return getCart(userId);
}

export async function addItem(
  userId: string,
  { productId, quantity }: { productId: string; quantity: number },
) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || !product.active) {
    throw new HTTPException(400, { message: 'Product not found or inactive' });
  }

  const cart = await prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
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
  const cart = await prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
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
  const cart = await prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
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
  await prisma.cart.update({
    where: { id: cart.id },
    data: { discountId: null },
  });
}
