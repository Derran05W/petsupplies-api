import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    cart: { findUnique: vi.fn() },
    order: { create: vi.fn(), update: vi.fn() },
    cartItem: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
  },
}));

vi.mock('../../src/services/stripeService.js', () => ({
  createCheckoutSessionFromCart: vi.fn(),
}));

import * as stripeService from '../../src/services/stripeService.js';
import { createApp } from '../../src/app.js';
import { HTTPException } from 'hono/http-exception';

const SECRET = 'test-jwt-secret-32chars-padding!!';

async function signToken(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

const mockCheckoutResult = {
  url: 'https://checkout.stripe.com/pay/cs_test_abc',
  orderId: 'order-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /checkout/session', () => {
  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/checkout/session', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 200 with { url, orderId } on happy path and calls service with userId', async () => {
    vi.mocked(stripeService.createCheckoutSessionFromCart).mockResolvedValue(mockCheckoutResult);

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/checkout/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof mockCheckoutResult;
    expect(body.url).toBe('https://checkout.stripe.com/pay/cs_test_abc');
    expect(body.orderId).toBe('order-1');
    expect(stripeService.createCheckoutSessionFromCart).toHaveBeenCalledWith('user-1');
  });

  it('returns 400 when service throws HTTPException 400 (empty cart)', async () => {
    vi.mocked(stripeService.createCheckoutSessionFromCart).mockRejectedValue(
      new HTTPException(400, { message: 'Cart is empty' }),
    );

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/checkout/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
  });

  it('returns 409 when service throws HTTPException 409 (insufficient stock)', async () => {
    vi.mocked(stripeService.createCheckoutSessionFromCart).mockRejectedValue(
      new HTTPException(409, { message: 'Insufficient stock for Dog Food' }),
    );

    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/checkout/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
  });
});
