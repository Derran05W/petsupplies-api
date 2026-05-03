import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    cart: { upsert: vi.fn(), findUnique: vi.fn() },
    cartItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    product: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as cartService from '../../src/services/cartService.js';

const mockCart = { id: 'cart-1', userId: 'user-1', createdAt: new Date(), updatedAt: new Date() };
const mockProduct = {
  id: 'prod-1',
  name: 'Dog Food',
  slug: 'dog-food',
  price: 2000,
  imageUrl: null,
  stock: 10,
  active: true,
};
const mockCartItem = {
  id: 'item-1',
  cartId: 'cart-1',
  productId: 'prod-1',
  quantity: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cartService.getCart', () => {
  it('returns cart shape with id, items, subtotalCents, freeShippingThresholdCents, freeShippingRemainingCents', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findMany).mockResolvedValue([
      { ...mockCartItem, product: mockProduct },
    ] as never);

    const result = await cartService.getCart('user-1');

    expect(result.id).toBe('cart-1');
    expect(result.items).toHaveLength(1);
    expect(result.subtotalCents).toBe(2 * 2000); // qty * price
    expect(result.freeShippingThresholdCents).toBe(5000);
    expect(result.freeShippingRemainingCents).toBe(5000 - 4000); // 1000
  });

  it('computes subtotal as sum of qty * price across all items', async () => {
    const secondItem = {
      id: 'item-2',
      cartId: 'cart-1',
      productId: 'prod-2',
      quantity: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      product: { ...mockProduct, id: 'prod-2', price: 1000 },
    };
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findMany).mockResolvedValue([
      { ...mockCartItem, product: mockProduct },
      secondItem,
    ] as never);

    const result = await cartService.getCart('user-1');

    // 2*2000 + 3*1000 = 4000 + 3000 = 7000
    expect(result.subtotalCents).toBe(7000);
    expect(result.freeShippingRemainingCents).toBe(0); // already exceeds threshold
  });

  it('sets freeShippingRemainingCents to 0 when subtotal exceeds threshold', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findMany).mockResolvedValue([
      { ...mockCartItem, quantity: 10, product: { ...mockProduct, price: 1000 } },
    ] as never);

    const result = await cartService.getCart('user-1');

    expect(result.subtotalCents).toBe(10000); // 10 * 1000
    expect(result.freeShippingRemainingCents).toBe(0);
  });

  it('returns empty items array for new cart', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findMany).mockResolvedValue([] as never);

    const result = await cartService.getCart('user-1');

    expect(result.items).toEqual([]);
    expect(result.subtotalCents).toBe(0);
    expect(result.freeShippingRemainingCents).toBe(5000);
  });
});

describe('cartService.addItem', () => {
  it('happy path: creates item via upsert', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct as never);
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.cartItem.upsert).mockResolvedValue(mockCartItem as never);

    const result = await cartService.addItem('user-1', { productId: 'prod-1', quantity: 2 });

    expect(prisma.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { cartId: 'cart-1', productId: 'prod-1', quantity: 2 },
        update: { quantity: 2 },
      }),
    );
    expect(result).toEqual(mockCartItem);
  });

  it('accumulates quantity when item already exists (existing 2 + new 3 = 5)', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct as never);
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue({
      ...mockCartItem,
      quantity: 2,
    } as never);
    vi.mocked(prisma.cartItem.upsert).mockResolvedValue({ ...mockCartItem, quantity: 5 } as never);

    await cartService.addItem('user-1', { productId: 'prod-1', quantity: 3 });

    expect(prisma.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { quantity: 5 },
      }),
    );
  });

  it('throws 400 when product is not found', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

    try {
      await cartService.addItem('user-1', { productId: 'prod-missing', quantity: 1 });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(400);
    }
  });

  it('throws 400 when product is inactive', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      ...mockProduct,
      active: false,
    } as never);

    try {
      await cartService.addItem('user-1', { productId: 'prod-1', quantity: 1 });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(400);
    }
  });

  it('throws 409 when stock < newQuantity', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ ...mockProduct, stock: 3 } as never);
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue({
      ...mockCartItem,
      quantity: 2,
    } as never);

    // existing 2 + new 2 = 4 but stock is 3
    try {
      await cartService.addItem('user-1', { productId: 'prod-1', quantity: 2 });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(409);
    }
  });
});

describe('cartService.updateItem', () => {
  it('happy path: updates item quantity', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue(mockCartItem as never);
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct as never);
    vi.mocked(prisma.cartItem.update).mockResolvedValue({ ...mockCartItem, quantity: 5 } as never);

    const result = await cartService.updateItem('user-1', 'item-1', 5);

    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { quantity: 5 },
    });
    expect(result).toMatchObject({ quantity: 5 });
  });

  it('deletes item and returns null when quantity is 0', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue(mockCartItem as never);
    vi.mocked(prisma.cartItem.delete).mockResolvedValue(mockCartItem as never);

    const result = await cartService.updateItem('user-1', 'item-1', 0);

    expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
    expect(result).toBeNull();
  });

  it('throws 404 when item not found', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue(null);

    try {
      await cartService.updateItem('user-1', 'item-missing', 3);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(404);
    }
  });

  it('throws 403 when item belongs to different cart', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue({
      ...mockCartItem,
      cartId: 'cart-other',
    } as never);

    try {
      await cartService.updateItem('user-1', 'item-1', 3);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(403);
    }
  });

  it('throws 409 when stock < quantity', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue(mockCartItem as never);
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ ...mockProduct, stock: 2 } as never);

    try {
      await cartService.updateItem('user-1', 'item-1', 5);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(409);
    }
  });

  it('throws 400 when product is inactive', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue(mockCartItem as never);
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      ...mockProduct,
      active: false,
    } as never);

    try {
      await cartService.updateItem('user-1', 'item-1', 3);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(400);
    }
  });
});

describe('cartService.removeItem', () => {
  it('happy path: deletes the item', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue(mockCartItem as never);
    vi.mocked(prisma.cartItem.delete).mockResolvedValue(mockCartItem as never);

    await cartService.removeItem('user-1', 'item-1');

    expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
  });

  it('throws 404 when item not found', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue(null);

    try {
      await cartService.removeItem('user-1', 'item-missing');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(404);
    }
  });

  it('throws 403 when item belongs to different cart', async () => {
    vi.mocked(prisma.cart.upsert).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.findUnique).mockResolvedValue({
      ...mockCartItem,
      cartId: 'cart-other',
    } as never);

    try {
      await cartService.removeItem('user-1', 'item-1');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPException);
      expect((e as HTTPException).status).toBe(403);
    }
  });
});

describe('cartService.clear', () => {
  it('no-op when cart does not exist', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue(null);

    await cartService.clear('user-1');

    expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('calls deleteMany when cart exists', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue(mockCart as never);
    vi.mocked(prisma.cartItem.deleteMany).mockResolvedValue({ count: 2 } as never);

    await cartService.clear('user-1');

    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: 'cart-1' } });
  });
});
