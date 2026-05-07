import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/services/wishlistService.js', () => ({
  MAX_LIMIT: 100,
  DEFAULT_LIMIT: 20,
  listWishlist: vi.fn(),
  addToWishlist: vi.fn(),
  removeFromWishlist: vi.fn(),
}));

import * as wishlistService from '../../src/services/wishlistService.js';
import { createApp } from '../../src/app.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

async function signToken(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

const SAMPLE_CUID = `c${'a'.repeat(24)}`;

const sampleItem = {
  id: 'wli-1',
  addedAt: new Date('2026-04-04T04:04:04.004Z'),
  product: {
    id: SAMPLE_CUID,
    name: 'Test',
    slug: 'test-slug',
    price: 1999,
    active: false,
    images: [] as {
      id: string;
      url: string;
      altText: string | null;
      sortOrder: number;
      isPrimary: boolean;
    }[],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /users/me/wishlist', () => {
  const envelope = {
    data: [sampleItem],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };

  it('GET /users/me/wishlist requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request('/users/me/wishlist');
    expect(res.status).toBe(401);
  });

  it('GET /users/me/wishlist forwards userId, default pagination, and sort=newest', async () => {
    vi.mocked(wishlistService.listWishlist).mockResolvedValue(envelope);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(wishlistService.listWishlist).toHaveBeenCalledWith({
      userId: 'user-1',
      page: 1,
      limit: 20,
      sort: 'newest',
    });
  });

  it('GET /users/me/wishlist accepts page, limit, and sort=oldest', async () => {
    vi.mocked(wishlistService.listWishlist).mockResolvedValue(envelope);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist?page=3&limit=50&sort=oldest', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(wishlistService.listWishlist).toHaveBeenCalledWith({
      userId: 'user-1',
      page: 3,
      limit: 50,
      sort: 'oldest',
    });
  });

  it('GET /users/me/wishlist rejects invalid page', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist?page=0', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    expect(wishlistService.listWishlist).not.toHaveBeenCalled();
  });

  it('GET /users/me/wishlist rejects invalid limit above 100', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist?limit=101', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    expect(wishlistService.listWishlist).not.toHaveBeenCalled();
  });

  it('GET /users/me/wishlist rejects invalid sort', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist?sort=price', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    expect(wishlistService.listWishlist).not.toHaveBeenCalled();
  });

  it('GET /users/me/wishlist returns paginated envelope with inactive product active=false', async () => {
    vi.mocked(wishlistService.listWishlist).mockResolvedValue(envelope);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof envelope;
    expect(body.data[0].product.active).toBe(false);
  });
});

describe('POST /users/me/wishlist', () => {
  it('POST /users/me/wishlist requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request('/users/me/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /users/me/wishlist validates productId is required', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(wishlistService.addToWishlist).not.toHaveBeenCalled();
  });

  it('POST /users/me/wishlist rejects unknown body keys', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId: SAMPLE_CUID, extra: true }),
    });
    expect(res.status).toBe(400);
    expect(wishlistService.addToWishlist).not.toHaveBeenCalled();
  });

  it('POST /users/me/wishlist returns 201 on first add', async () => {
    vi.mocked(wishlistService.addToWishlist).mockResolvedValue({ item: sampleItem, created: true });
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId: SAMPLE_CUID }),
    });
    expect(res.status).toBe(201);
    expect(wishlistService.addToWishlist).toHaveBeenCalledWith({
      userId: 'user-1',
      productId: SAMPLE_CUID,
    });
  });

  it('POST /users/me/wishlist returns 200 on idempotent re-add', async () => {
    vi.mocked(wishlistService.addToWishlist).mockResolvedValue({
      item: sampleItem,
      created: false,
    });
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId: SAMPLE_CUID }),
    });
    expect(res.status).toBe(200);
  });

  it('POST /users/me/wishlist returns 404 NOT_FOUND when product is missing', async () => {
    vi.mocked(wishlistService.addToWishlist).mockRejectedValue(
      new HTTPException(404, { message: 'NOT_FOUND' }),
    );
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId: `c${'z'.repeat(24)}` }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });

  it('POST /users/me/wishlist returns 400 WISHLIST_FULL when at capacity', async () => {
    vi.mocked(wishlistService.addToWishlist).mockRejectedValue(
      new HTTPException(400, { message: 'WISHLIST_FULL' }),
    );
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/wishlist', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId: SAMPLE_CUID }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('WISHLIST_FULL');
  });
});

describe('DELETE /users/me/wishlist/:productId', () => {
  it('DELETE /users/me/wishlist/:productId requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request(`/users/me/wishlist/${SAMPLE_CUID}`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('DELETE /users/me/wishlist/:productId returns 204 when item existed', async () => {
    vi.mocked(wishlistService.removeFromWishlist).mockResolvedValue(undefined);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/wishlist/${SAMPLE_CUID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
  });

  it('DELETE /users/me/wishlist/:productId returns 204 when item did not exist', async () => {
    vi.mocked(wishlistService.removeFromWishlist).mockResolvedValue(undefined);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/wishlist/${SAMPLE_CUID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
  });

  it('DELETE /users/me/wishlist/:productId forwards userId and productId to wishlistService.removeFromWishlist', async () => {
    vi.mocked(wishlistService.removeFromWishlist).mockResolvedValue(undefined);
    const token = await signToken('user-77');
    const app = createApp();
    const pid = `c${'b'.repeat(24)}`;
    const res = await app.request(`/users/me/wishlist/${pid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
    expect(wishlistService.removeFromWishlist).toHaveBeenCalledWith({
      userId: 'user-77',
      productId: pid,
    });
  });
});
