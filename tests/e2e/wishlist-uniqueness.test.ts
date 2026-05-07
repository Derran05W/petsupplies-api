import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { ProductCategory } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { signTestUserJwt } from '../helpers/jwt.js';

async function wipeWishlistArtifacts(userIds: string[], productIds: string[]) {
  if (productIds.length) {
    await prisma.wishlistItem.deleteMany({
      where: { productId: { in: productIds } },
    });
  }
  if (userIds.length) {
    await prisma.wishlistItem.deleteMany({
      where: { userId: { in: userIds } },
    });
  }
  if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describe.sequential('E2E: wishlist uniqueness', () => {
  const runId = randomUUID().slice(0, 8);

  afterAll(async () => {
    // best-effort; each test clears its rows
    await prisma.wishlistItem
      .deleteMany({
        where: { userId: { startsWith: `e2e_wl_${runId}` } },
      })
      .catch(() => {});
    await prisma.product
      .deleteMany({ where: { slug: { startsWith: `e2e_wl_${runId}` } } })
      .catch(() => {});
    await prisma.user
      .deleteMany({ where: { id: { startsWith: `e2e_wl_${runId}` } } })
      .catch(() => {});
  });

  describe('constraints', () => {
    beforeEach(async () => {
      await prisma.wishlistItem.deleteMany({
        where: { userId: { startsWith: `e2e_wl_${runId}` } },
      });
      await prisma.product.deleteMany({ where: { slug: { startsWith: `e2e_wl_${runId}_` } } });
      await prisma.user.deleteMany({ where: { id: { startsWith: `e2e_wl_${runId}_` } } });
    });

    it('real DB enforces @@unique([userId, productId]) for duplicate wishlist rows', async () => {
      const userId = `e2e_wl_${runId}_uuniq`;
      const slug = `e2e_wl_${runId}_uuniq_slug`;
      await prisma.user.create({
        data: { id: userId, email: `${userId}@petsupplies.test` },
      });
      const prod = await prisma.product.create({
        data: {
          slug,
          name: 'Uniq product',
          description: 'E2E',
          price: 100,
          stock: 10,
          category: ProductCategory.DOG,
          active: true,
        },
      });
      await prisma.wishlistItem.create({
        data: { userId, productId: prod.id },
      });
      await expect(
        prisma.wishlistItem.create({
          data: { userId, productId: prod.id },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      await wipeWishlistArtifacts([userId], [prod.id]);
    });

    it('POST /users/me/wishlist returns 201 then 200 for the same product and user', async () => {
      const userId = `e2e_wl_${runId}_uhttp`;
      const slug = `e2e_wl_${runId}_uhttp_slug`;
      await prisma.user.create({
        data: { id: userId, email: `${userId}@petsupplies.test` },
      });
      const prod = await prisma.product.create({
        data: {
          slug,
          name: 'Http flow',
          description: 'E2E',
          price: 200,
          stock: 10,
          category: ProductCategory.CAT,
          active: true,
        },
      });

      const app = createApp();
      const token = await signTestUserJwt(userId);
      const body = JSON.stringify({ productId: prod.id });

      const r1 = await app.request('/users/me/wishlist', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      expect(r1.status).toBe(201);

      const r2 = await app.request('/users/me/wishlist', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      expect(r2.status).toBe(200);

      await wipeWishlistArtifacts([userId], [prod.id]);
    });

    it('re-add round trip preserves the original addedAt timestamp', async () => {
      const userId = `e2e_wl_${runId}_uadd`;
      const slug = `e2e_wl_${runId}_uadd_slug`;
      await prisma.user.create({
        data: { id: userId, email: `${userId}@petsupplies.test` },
      });
      const prod = await prisma.product.create({
        data: {
          slug,
          name: 'Add twice',
          description: 'E2E',
          price: 300,
          stock: 10,
          category: ProductCategory.BIRD,
          active: false,
        },
      });

      const app = createApp();
      const token = await signTestUserJwt(userId);
      const body = JSON.stringify({ productId: prod.id });

      const r1 = await app.request('/users/me/wishlist', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      const j1 = (await r1.json()) as { addedAt: string };
      await new Promise((r) => setTimeout(r, 15));
      const r2 = await app.request('/users/me/wishlist', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      const j2 = (await r2.json()) as { addedAt: string };
      expect(j1.addedAt).toBe(j2.addedAt);

      await wipeWishlistArtifacts([userId], [prod.id]);
    });

    it('same product can be wishlisted by two different users', async () => {
      const ua = `e2e_wl_${runId}_ua`;
      const ub = `e2e_wl_${runId}_ub`;
      const slug = `e2e_wl_${runId}_dual_slug`;
      await prisma.user.createMany({
        data: [
          { id: ua, email: `${ua}@petsupplies.test` },
          { id: ub, email: `${ub}@petsupplies.test` },
        ],
      });
      const prod = await prisma.product.create({
        data: {
          slug,
          name: 'Two users',
          description: 'E2E',
          price: 400,
          stock: 10,
          category: ProductCategory.FISH,
          active: true,
        },
      });

      const app = createApp();
      const ra = await app.request('/users/me/wishlist', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await signTestUserJwt(ua)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId: prod.id }),
      });
      const rb = await app.request('/users/me/wishlist', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await signTestUserJwt(ub)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productId: prod.id }),
      });
      expect(ra.status).toBe(201);
      expect(rb.status).toBe(201);

      const count = await prisma.wishlistItem.count({
        where: { productId: prod.id },
      });
      expect(count).toBe(2);

      await wipeWishlistArtifacts([ua, ub], [prod.id]);
    });

    it('DELETE /users/me/wishlist/:productId removes only the authenticated user row', async () => {
      const ua = `e2e_wl_${runId}_udela`;
      const ub = `e2e_wl_${runId}_udelb`;
      const slug = `e2e_wl_${runId}_udel_slug`;
      await prisma.user.createMany({
        data: [
          { id: ua, email: `${ua}@petsupplies.test` },
          { id: ub, email: `${ub}@petsupplies.test` },
        ],
      });
      const prod = await prisma.product.create({
        data: {
          slug,
          name: 'Delete scoped',
          description: 'E2E',
          price: 500,
          stock: 10,
          category: ProductCategory.DOG,
          active: true,
        },
      });
      await prisma.wishlistItem.createMany({
        data: [
          { userId: ua, productId: prod.id },
          { userId: ub, productId: prod.id },
        ],
      });

      const app = createApp();
      const tokenA = await signTestUserJwt(ua);
      const res = await app.request(`/users/me/wishlist/${prod.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect(res.status).toBe(204);

      const left = await prisma.wishlistItem.findMany({ where: { productId: prod.id } });
      expect(left).toHaveLength(1);
      expect(left[0].userId).toBe(ub);

      await wipeWishlistArtifacts([ua, ub], [prod.id]);
    });

    it('DELETE /users/me/wishlist/:productId is idempotent across repeated calls', async () => {
      const userId = `e2e_wl_${runId}_uidemp`;
      const slug = `e2e_wl_${runId}_uidemp_slug`;
      await prisma.user.create({
        data: { id: userId, email: `${userId}@petsupplies.test` },
      });
      const prod = await prisma.product.create({
        data: {
          slug,
          name: 'Idempotent delete',
          description: 'E2E',
          price: 600,
          stock: 10,
          category: ProductCategory.HEALTH,
          active: true,
        },
      });
      await prisma.wishlistItem.create({ data: { userId, productId: prod.id } });

      const app = createApp();
      const token = await signTestUserJwt(userId);
      const d1 = await app.request(`/users/me/wishlist/${prod.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d2 = await app.request(`/users/me/wishlist/${prod.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(d1.status).toBe(204);
      expect(d2.status).toBe(204);

      await wipeWishlistArtifacts([userId], [prod.id]);
    });
  });
});
