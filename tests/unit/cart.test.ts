import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

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

vi.mock('../../src/services/cartService.js', () => ({
  getCart: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}));

import * as cartService from '../../src/services/cartService.js';
import { createApp } from '../../src/app.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';

async function signToken(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .sign(new TextEncoder().encode(SECRET));
}

const mockCartResponse = {
  id: 'cart-1',
  items: [
    {
      id: 'item-1',
      productId: 'prod-1',
      quantity: 2,
      product: {
        id: 'prod-1',
        name: 'Dog Food',
        slug: 'dog-food',
        price: 2000,
        imageUrl: null,
        stock: 10,
        active: true,
      },
    },
  ],
  subtotalCents: 4000,
  freeShippingThresholdCents: 5000,
  freeShippingRemainingCents: 1000,
};

const mockCartItem = {
  id: 'item-1',
  cartId: 'cart-1',
  productId: 'prod-1',
  quantity: 2,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /cart', () => {
  it('returns 200 with cart response when authenticated', async () => {
    vi.mocked(cartService.getCart).mockResolvedValue(mockCartResponse as never);

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/cart', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof mockCartResponse;
    expect(body.id).toBe('cart-1');
    expect(body.subtotalCents).toBe(4000);
    expect(body.freeShippingThresholdCents).toBe(5000);
    expect(body.freeShippingRemainingCents).toBe(1000);
  });

  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/cart');
    expect(res.status).toBe(401);
  });
});

describe('POST /cart/items', () => {
  it('returns 201 with created item when body is valid', async () => {
    vi.mocked(cartService.addItem).mockResolvedValue(mockCartItem as never);

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId: 'prod-1', quantity: 2 }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as typeof mockCartItem;
    expect(body.id).toBe('item-1');
  });

  it('returns 400 when productId is missing', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ quantity: 2 }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when quantity is 0 (Zod requires positive)', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/cart/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId: 'prod-1', quantity: 0 }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/cart/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 'prod-1', quantity: 2 }),
    });

    expect(res.status).toBe(401);
  });
});

describe('PATCH /cart/items/:id', () => {
  it('returns 200 with updated item when quantity > 0', async () => {
    vi.mocked(cartService.updateItem).mockResolvedValue({ ...mockCartItem, quantity: 2 } as never);

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/cart/items/item-1', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ quantity: 2 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof mockCartItem;
    expect(body.quantity).toBe(2);
  });

  it('returns 204 when quantity is 0 and service returns null', async () => {
    vi.mocked(cartService.updateItem).mockResolvedValue(null as never);

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/cart/items/item-1', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ quantity: 0 }),
    });

    expect(res.status).toBe(204);
  });

  it('returns 400 when quantity is negative', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/cart/items/item-1', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ quantity: -1 }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/cart/items/item-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 2 }),
    });

    expect(res.status).toBe(401);
  });
});

describe('DELETE /cart/items/:id', () => {
  it('returns 204 when item is deleted', async () => {
    vi.mocked(cartService.removeItem).mockResolvedValue(undefined);

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/cart/items/item-1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(204);
  });

  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/cart/items/item-1', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /cart', () => {
  it('returns 204 when cart is cleared', async () => {
    vi.mocked(cartService.clear).mockResolvedValue(undefined);

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/cart', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(204);
  });

  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/cart', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});
