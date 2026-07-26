import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../../src/services/subscriptionService.js', () => ({
  MAX_ACTIVE_SUBSCRIPTIONS_PER_USER: 25,
  createSubscription: vi.fn(),
  listSubscriptions: vi.fn(),
  getSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  pauseSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
}));

import * as subscriptionService from '../../src/services/subscriptionService.js';
import { createApp } from '../../src/app.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

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

const SAMPLE_CUID = `c${'a'.repeat(24)}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /subscriptions', () => {
  it('requires auth', async () => {
    const app = createApp();
    const res = await app.request('/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: SAMPLE_CUID,
        quantity: 1,
        interval: 'WEEK_4',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects invalid productId shape', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productId: 'bad',
        quantity: 1,
        interval: 'WEEK_4',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('forwards valid body to service', async () => {
    vi.mocked(subscriptionService.createSubscription).mockResolvedValue({
      url: 'https://stripe.test',
      checkoutSessionId: 'cs_1',
    });
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productId: SAMPLE_CUID,
        quantity: 2,
        interval: 'WEEK_8',
      }),
    });
    expect(res.status).toBe(200);
    expect(subscriptionService.createSubscription).toHaveBeenCalledWith('user-1', {
      productId: SAMPLE_CUID,
      quantity: 2,
      interval: 'WEEK_8',
    });
  });
});

describe('GET /users/me/subscriptions', () => {
  it('requires auth', async () => {
    const app = createApp();
    const res = await app.request('/users/me/subscriptions');
    expect(res.status).toBe(401);
  });

  it('forwards pagination', async () => {
    vi.mocked(subscriptionService.listSubscriptions).mockResolvedValue({
      data: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/subscriptions?page=2&limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(subscriptionService.listSubscriptions).toHaveBeenCalledWith('user-1', {
      page: 2,
      limit: 10,
    });
  });
});

describe('PATCH /users/me/subscriptions/:id', () => {
  it('rejects EMPTY_PATCH', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/subscriptions/${SAMPLE_CUID}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
