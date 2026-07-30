import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { HTTPException } from 'hono/http-exception';
import { ProductCategory } from '@prisma/client';

vi.mock('../../src/services/reviewService.js', () => ({
  createReview: vi.fn(),
  listReviewsByProductSlug: vi.fn(),
  updateReview: vi.fn(),
  deleteReview: vi.fn(),
}));

import * as reviewService from '../../src/services/reviewService.js';
import { prisma } from '../../src/lib/prisma.js';
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

const slug = `it_rev_${randomUUID().slice(0, 12)}`;
let productId: string;

beforeAll(async () => {
  const p = await prisma.product.create({
    data: {
      slug,
      name: 'Integration Review Product',
      description: 'Integration reviews route tests.',
      price: 1000,
      stock: 10,
      category: ProductCategory.DOG,
      active: true,
    },
  });
  productId = p.id;
});

afterAll(async () => {
  await prisma.review.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
});

beforeEach(() => {
  vi.clearAllMocks();
});

const sampleReview = {
  id: 'rev-1',
  productId: 'p1',
  userId: 'user-1',
  displayName: 'Taylor V.',
  rating: 5,
  title: 'Great',
  body: 'Nice',
  verified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('POST /products/:slug/reviews', () => {
  it('POST /products/:slug/reviews requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5, body: 'x'.repeat(10) }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /products/:slug/reviews returns 403 PURCHASE_REQUIRED when user has no eligible order', async () => {
    vi.mocked(reviewService.createReview).mockRejectedValue(
      new HTTPException(403, { message: 'PURCHASE_REQUIRED' }),
    );
    const token = await signToken('user-no-order');
    const app = createApp();
    const res = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 5, body: 'Good product' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PURCHASE_REQUIRED');
  });

  it('POST /products/:slug/reviews returns 201 with full review payload on success', async () => {
    vi.mocked(reviewService.createReview).mockResolvedValue(sampleReview);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 5, body: 'Good product', title: 'Hi' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as typeof sampleReview;
    expect(body.id).toBe('rev-1');
    expect(body.verified).toBe(true);
    expect(reviewService.createReview).toHaveBeenCalledWith({
      productId,
      userId: 'user-1',
      rating: 5,
      body: 'Good product',
      title: 'Hi',
    });
  });

  it('POST /products/:slug/reviews returns 409 ALREADY_REVIEWED on duplicate', async () => {
    vi.mocked(reviewService.createReview).mockRejectedValue(
      new HTTPException(409, { message: 'ALREADY_REVIEWED' }),
    );
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 4, body: 'Again' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ALREADY_REVIEWED');
  });

  it('POST /products/:slug/reviews returns 400 on rating out of bounds', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 99, body: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /products/:slug/reviews returns 400 on body too long', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 3, body: 'x'.repeat(2001) }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /products/:slug/reviews', () => {
  const envelope = {
    data: [sampleReview],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };

  it('GET /products/:slug/reviews is public (no Authorization header)', async () => {
    vi.mocked(reviewService.listReviewsByProductSlug).mockResolvedValue(envelope);
    const app = createApp();
    const res = await app.request(`/products/${slug}/reviews`);
    expect(res.status).toBe(200);
  });

  it('GET /products/:slug/reviews returns paginated envelope with default sort=newest', async () => {
    vi.mocked(reviewService.listReviewsByProductSlug).mockResolvedValue(envelope);
    const app = createApp();
    const res = await app.request(`/products/${slug}/reviews`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof envelope;
    expect(body.data).toHaveLength(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(reviewService.listReviewsByProductSlug).toHaveBeenCalledWith({
      slug,
      page: 1,
      limit: 20,
      sort: 'newest',
    });
  });

  it('GET /products/:slug/reviews?sort=rating_desc orders by rating descending', async () => {
    vi.mocked(reviewService.listReviewsByProductSlug).mockResolvedValue(envelope);
    const app = createApp();
    const res = await app.request(`/products/${slug}/reviews?sort=rating_desc`);
    expect(res.status).toBe(200);
    expect(reviewService.listReviewsByProductSlug).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'rating_desc' }),
    );
  });

  it('GET /products/:slug/reviews?sort=oldest orders by createdAt ascending', async () => {
    vi.mocked(reviewService.listReviewsByProductSlug).mockResolvedValue(envelope);
    const app = createApp();
    const res = await app.request(`/products/${slug}/reviews?sort=oldest`);
    expect(res.status).toBe(200);
    expect(reviewService.listReviewsByProductSlug).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'oldest' }),
    );
  });

  it('GET /products/:slug/reviews returns 404 when slug does not exist', async () => {
    vi.mocked(reviewService.listReviewsByProductSlug).mockRejectedValue(
      new HTTPException(404, { message: 'NOT_FOUND' }),
    );
    const app = createApp();
    const res = await app.request('/products/no-such-slug-ever/reviews');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /reviews/:id', () => {
  it('PATCH /reviews/:id requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request('/reviews/rev-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 4 }),
    });
    expect(res.status).toBe(401);
  });

  it("PATCH /reviews/:id returns 403 NOT_OWNER for someone else's review", async () => {
    vi.mocked(reviewService.updateReview).mockRejectedValue(
      new HTTPException(403, { message: 'NOT_OWNER' }),
    );
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/reviews/rev-other', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: 'Updated content here' }),
    });
    expect(res.status).toBe(403);
  });

  it('PATCH /reviews/:id forwards rating/title/body fields to reviewService.updateReview', async () => {
    vi.mocked(reviewService.updateReview).mockResolvedValue({ ...sampleReview, rating: 2 });
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/reviews/rev-1', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 2, title: 'T', body: 'B' }),
    });
    expect(res.status).toBe(200);
    expect(reviewService.updateReview).toHaveBeenCalledWith('rev-1', 'user-1', {
      rating: 2,
      title: 'T',
      body: 'B',
    });
  });
});

describe('DELETE /reviews/:id', () => {
  it('DELETE /reviews/:id requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request('/reviews/rev-1', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('DELETE /reviews/:id returns 204 on success', async () => {
    vi.mocked(reviewService.deleteReview).mockResolvedValue(undefined);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/reviews/rev-1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
  });

  it("DELETE /reviews/:id returns 403 NOT_OWNER for someone else's review", async () => {
    vi.mocked(reviewService.deleteReview).mockRejectedValue(
      new HTTPException(403, { message: 'NOT_OWNER' }),
    );
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/reviews/rev-other', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });
});
