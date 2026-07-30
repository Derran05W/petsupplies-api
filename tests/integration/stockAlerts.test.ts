import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../../src/services/stockAlertService.js', () => ({
  MAX_LIMIT: 100,
  DEFAULT_LIMIT: 20,
  listStockAlerts: vi.fn(),
  addStockAlert: vi.fn(),
  removeStockAlert: vi.fn(),
}));

import * as stockAlertService from '../../src/services/stockAlertService.js';
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

const sampleItem = {
  id: 'sa-1',
  createdAt: new Date('2026-04-04T04:04:04.004Z'),
  notifiedAt: null as Date | null,
  product: {
    id: SAMPLE_CUID,
    name: 'Test',
    slug: 'test-slug',
    price: 1999,
    active: true,
    stock: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /users/me/stock-alerts', () => {
  const envelope = {
    data: [sampleItem],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };

  it('requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request('/users/me/stock-alerts');
    expect(res.status).toBe(401);
  });

  it('forwards userId and default pagination', async () => {
    vi.mocked(stockAlertService.listStockAlerts).mockResolvedValue(envelope);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/stock-alerts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(stockAlertService.listStockAlerts).toHaveBeenCalledWith({
      userId: 'user-1',
      page: 1,
      limit: 20,
      sort: 'newest',
    });
    const body = await res.json();
    expect(body).toEqual({
      ...envelope,
      data: envelope.data.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  });
});

describe('POST /users/me/stock-alerts', () => {
  it('returns 201 when created', async () => {
    vi.mocked(stockAlertService.addStockAlert).mockResolvedValue({
      item: sampleItem,
      created: true,
    });
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/stock-alerts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId: SAMPLE_CUID }),
    });
    expect(res.status).toBe(201);
    expect(stockAlertService.addStockAlert).toHaveBeenCalledWith({
      userId: 'user-1',
      productId: SAMPLE_CUID,
    });
  });

  it('returns 200 when duplicate noop', async () => {
    vi.mocked(stockAlertService.addStockAlert).mockResolvedValue({
      item: sampleItem,
      created: false,
    });
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/stock-alerts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId: SAMPLE_CUID }),
    });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /users/me/stock-alerts/:productId', () => {
  it('returns 204', async () => {
    vi.mocked(stockAlertService.removeStockAlert).mockResolvedValue();
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/stock-alerts/${SAMPLE_CUID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
    expect(stockAlertService.removeStockAlert).toHaveBeenCalledWith({
      userId: 'user-1',
      productId: SAMPLE_CUID,
    });
  });
});
