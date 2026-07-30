import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { createApp } from '../../src/app.js';

vi.mock('../../src/services/cartService.js', () => ({
  getCart: vi.fn(),
  applyDiscount: vi.fn(),
  removeDiscount: vi.fn(),
}));

import * as cartService from '../../src/services/cartService.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

async function customerToken(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .sign(new TextEncoder().encode(SECRET));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cart discount routes', () => {
  it('returns 401 for POST /cart/discount without auth', async () => {
    const app = createApp();
    const res = await app.request('/cart/discount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'SAVE10' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for malformed discount code before service', async () => {
    const token = await customerToken('u1');
    const app = createApp();
    const res = await app.request('/cart/discount', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'no' }),
    });
    expect(res.status).toBe(400);
    expect(cartService.applyDiscount).not.toHaveBeenCalled();
  });

  it('returns refreshed cart on happy path', async () => {
    vi.mocked(cartService.applyDiscount).mockResolvedValue({
      ok: true,
      cart: {
        id: 'c1',
        items: [],
        subtotalCents: 0,
        appliedDiscountCents: 0,
        shippingCents: 599,
        shippingDiscountCents: 0,
        totalCents: 599,
        freeShippingThresholdCents: 5000,
        freeShippingRemainingCents: 5000,
      },
    });
    const token = await customerToken('u1');
    const app = createApp();
    const res = await app.request('/cart/discount', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'SAVE10' }),
    });
    expect(res.status).toBe(200);
    expect(cartService.applyDiscount).toHaveBeenCalledWith('u1', 'SAVE10');
  });

  it('maps NOT_FOUND to generic 400', async () => {
    vi.mocked(cartService.applyDiscount).mockResolvedValue({
      ok: false,
      reason: 'NOT_FOUND',
    });
    const token = await customerToken('u1');
    const app = createApp();
    const res = await app.request('/cart/discount', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'MISSING' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe('NOT_FOUND');
  });

  it('maps MIN_CART_NOT_MET to 409', async () => {
    vi.mocked(cartService.applyDiscount).mockResolvedValue({
      ok: false,
      reason: 'MIN_CART_NOT_MET',
    });
    const token = await customerToken('u1');
    const app = createApp();
    const res = await app.request('/cart/discount', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'SAVE10' }),
    });
    expect(res.status).toBe(409);
  });

  it('supports DELETE /cart/discount', async () => {
    vi.mocked(cartService.removeDiscount).mockResolvedValue({
      id: 'c1',
      items: [],
      subtotalCents: 0,
      appliedDiscountCents: 0,
      shippingCents: 599,
      shippingDiscountCents: 0,
      totalCents: 599,
      freeShippingThresholdCents: 5000,
      freeShippingRemainingCents: 5000,
    });
    const token = await customerToken('u1');
    const app = createApp();
    const res = await app.request('/cart/discount', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(cartService.removeDiscount).toHaveBeenCalledWith('u1');
  });
});
