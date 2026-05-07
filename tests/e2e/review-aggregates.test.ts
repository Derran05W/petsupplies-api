import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ProductCategory } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { signTestUserJwt } from '../helpers/jwt.js';

async function assertProductAggregatesMatchDb(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  const agg = await prisma.review.aggregate({
    where: { productId },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const expectedAvg = agg._count._all === 0 ? null : agg._avg.rating;
  expect(product?.reviewCount).toBe(agg._count._all);
  if (expectedAvg == null) {
    expect(product?.avgRating).toBeNull();
  } else {
    expect(product?.avgRating).toBeCloseTo(expectedAvg as number, 10);
  }
}

async function seedPaidOrderForProduct(userId: string, productId: string) {
  await prisma.order.create({
    data: {
      userId,
      status: 'PAID',
      totalCents: 1000,
      items: {
        create: [{ productId, quantity: 1, priceCents: 1000 }],
      },
    },
  });
}

describe.sequential('E2E: review aggregates', () => {
  const runId = randomUUID().slice(0, 8);
  let productId: string;
  let productSlug: string;
  let userId: string;

  beforeAll(async () => {
    productSlug = `e2e_rev_prod_${runId}`;
    userId = `e2e_rev_user_${runId}`;
    await prisma.user.create({
      data: { id: userId, email: `e2e_rev_${runId}@petsupplies.test` },
    });
    const p = await prisma.product.create({
      data: {
        slug: productSlug,
        name: 'Review aggregate test product',
        description: 'E2E reviews',
        price: 1000,
        stock: 100,
        category: ProductCategory.DOG,
        active: true,
      },
    });
    productId = p.id;
    await seedPaidOrderForProduct(userId, productId);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      await prisma.review.deleteMany({ where: { productId: productId! } });
      await prisma.orderItem.deleteMany({ where: { order: { userId } } });
      await prisma.order.deleteMany({ where: { userId } });
      if (productId) await prisma.product.deleteMany({ where: { id: productId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    } catch {
      // best-effort
    }
  });

  it('first PAID review on a product sets avgRating to that rating and reviewCount to 1', async () => {
    const app = createApp();
    const token = await signTestUserJwt(userId);
    const res = await app.request(`/products/${productSlug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 5, body: 'Excellent' }),
    });
    expect(res.status).toBe(201);
    await assertProductAggregatesMatchDb(productId);
    const p = await prisma.product.findUnique({ where: { id: productId } });
    expect(p?.reviewCount).toBe(1);
    expect(p?.avgRating).toBeCloseTo(5, 10);
  });

  it('two sequential PAID reviews on the same product compute correct avg and count=2', async () => {
    const slug = `e2e_rev_two_${runId}`;
    const u1 = `e2e_rev_u1_${runId}`;
    const u2 = `e2e_rev_u2_${runId}`;
    await prisma.user.createMany({
      data: [
        { id: u1, email: `e2e_rev_2a_${runId}@petsupplies.test` },
        { id: u2, email: `e2e_rev_2b_${runId}@petsupplies.test` },
      ],
    });
    const p = await prisma.product.create({
      data: {
        slug,
        name: 'Two reviewers',
        description: 'E2E',
        price: 500,
        stock: 50,
        category: ProductCategory.CAT,
        active: true,
      },
    });
    await seedPaidOrderForProduct(u1, p.id);
    await seedPaidOrderForProduct(u2, p.id);

    const app = createApp();
    const r1 = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await signTestUserJwt(u1)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 4, body: 'Four stars' }),
    });
    const r2 = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await signTestUserJwt(u2)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 2, body: 'Two stars' }),
    });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    await assertProductAggregatesMatchDb(p.id);
    const prod = await prisma.product.findUnique({ where: { id: p.id } });
    expect(prod?.reviewCount).toBe(2);
    expect(prod?.avgRating).toBeCloseTo(3, 10);

    await prisma.review.deleteMany({ where: { productId: p.id } });
    await prisma.orderItem.deleteMany({ where: { order: { userId: { in: [u1, u2] } } } });
    await prisma.order.deleteMany({ where: { userId: { in: [u1, u2] } } });
    await prisma.product.deleteMany({ where: { id: p.id } });
    await prisma.user.deleteMany({ where: { id: { in: [u1, u2] } } });
  }, 60_000);

  it('PATCH that changes rating updates avgRating without changing count', async () => {
    const slug = `e2e_rev_patch_${runId}`;
    const u = `e2e_rev_patch_u_${runId}`;
    await prisma.user.create({
      data: { id: u, email: `e2e_rev_p_${runId}@petsupplies.test` },
    });
    const p = await prisma.product.create({
      data: {
        slug,
        name: 'Patch test',
        description: 'E2E',
        price: 800,
        stock: 20,
        category: ProductCategory.DOG,
        active: true,
      },
    });
    await seedPaidOrderForProduct(u, p.id);

    const app = createApp();
    const token = await signTestUserJwt(u);
    const post = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 5, body: 'First' }),
    });
    expect(post.status).toBe(201);
    const { id: reviewId } = (await post.json()) as { id: string };

    const patch = await app.request(`/reviews/${reviewId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 1 }),
    });
    expect(patch.status).toBe(200);

    await assertProductAggregatesMatchDb(p.id);
    const prod = await prisma.product.findUnique({ where: { id: p.id } });
    expect(prod?.reviewCount).toBe(1);
    expect(prod?.avgRating).toBeCloseTo(1, 10);

    await prisma.review.deleteMany({ where: { id: reviewId } });
    await prisma.orderItem.deleteMany({ where: { order: { userId: u } } });
    await prisma.order.deleteMany({ where: { userId: u } });
    await prisma.product.deleteMany({ where: { id: p.id } });
    await prisma.user.deleteMany({ where: { id: u } });
  }, 60_000);

  it('DELETE removes the row and recomputes avgRating/reviewCount; reviewCount=0 yields avgRating=null', async () => {
    const slug = `e2e_rev_del_${runId}`;
    const u = `e2e_rev_del_u_${runId}`;
    await prisma.user.create({
      data: { id: u, email: `e2e_rev_d_${runId}@petsupplies.test` },
    });
    const p = await prisma.product.create({
      data: {
        slug,
        name: 'Delete test',
        description: 'E2E',
        price: 800,
        stock: 20,
        category: ProductCategory.DOG,
        active: true,
      },
    });
    await seedPaidOrderForProduct(u, p.id);

    const app = createApp();
    const token = await signTestUserJwt(u);
    const post = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 3, body: 'Mid' }),
    });
    expect(post.status).toBe(201);
    const { id: reviewId } = (await post.json()) as { id: string };

    const del = await app.request(`/reviews/${reviewId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(204);

    await assertProductAggregatesMatchDb(p.id);
    const prod = await prisma.product.findUnique({ where: { id: p.id } });
    expect(prod?.reviewCount).toBe(0);
    expect(prod?.avgRating).toBeNull();

    await prisma.orderItem.deleteMany({ where: { order: { userId: u } } });
    await prisma.order.deleteMany({ where: { userId: u } });
    await prisma.product.deleteMany({ where: { id: p.id } });
    await prisma.user.deleteMany({ where: { id: u } });
  }, 60_000);

  it('verified is true on the row written via the verified-purchase happy path', async () => {
    const slug = `e2e_rev_ver_${runId}`;
    const u = `e2e_rev_ver_u_${runId}`;
    await prisma.user.create({
      data: { id: u, email: `e2e_rev_v_${runId}@petsupplies.test` },
    });
    const p = await prisma.product.create({
      data: {
        slug,
        name: 'Verified test',
        description: 'E2E',
        price: 800,
        stock: 20,
        category: ProductCategory.DOG,
        active: true,
      },
    });
    await seedPaidOrderForProduct(u, p.id);

    const app = createApp();
    const post = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await signTestUserJwt(u)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 5, body: 'Verified buyer' }),
    });
    expect(post.status).toBe(201);
    const { id: reviewId } = (await post.json()) as { id: string };
    const row = await prisma.review.findUnique({ where: { id: reviewId } });
    expect(row?.verified).toBe(true);

    await prisma.review.deleteMany({ where: { id: reviewId } });
    await prisma.orderItem.deleteMany({ where: { order: { userId: u } } });
    await prisma.order.deleteMany({ where: { userId: u } });
    await prisma.product.deleteMany({ where: { id: p.id } });
    await prisma.user.deleteMany({ where: { id: u } });
  }, 60_000);

  it('@@unique([productId, userId]) blocks a second POST from the same user with P2002', async () => {
    const slug = `e2e_rev_dup_${runId}`;
    const u = `e2e_rev_dup_u_${runId}`;
    await prisma.user.create({
      data: { id: u, email: `e2e_rev_dup_${runId}@petsupplies.test` },
    });
    const p = await prisma.product.create({
      data: {
        slug,
        name: 'Dup test',
        description: 'E2E',
        price: 800,
        stock: 20,
        category: ProductCategory.DOG,
        active: true,
      },
    });
    await seedPaidOrderForProduct(u, p.id);

    const app = createApp();
    const token = await signTestUserJwt(u);
    const first = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 5, body: 'One' }),
    });
    expect(first.status).toBe(201);
    const second = await app.request(`/products/${slug}/reviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 4, body: 'Two' }),
    });
    expect(second.status).toBe(409);

    await prisma.review.deleteMany({ where: { productId: p.id } });
    await prisma.orderItem.deleteMany({ where: { order: { userId: u } } });
    await prisma.order.deleteMany({ where: { userId: u } });
    await prisma.product.deleteMany({ where: { id: p.id } });
    await prisma.user.deleteMany({ where: { id: u } });
  }, 60_000);
});
