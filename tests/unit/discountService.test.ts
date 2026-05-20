import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';

const mStripe = vi.hoisted(() => ({
  coupons: { create: vi.fn() },
}));

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: mStripe,
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    discount: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    discountUsage: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as discountService from '../../src/services/discountService.js';

const baseDiscountRow = {
  id: 'disc-1',
  code: 'SAVE10',
  type: 'PERCENTAGE' as const,
  value: 10,
  minCartCents: null as number | null,
  maxRedemptions: null as number | null,
  usedCount: 0,
  validFrom: null as Date | null,
  validUntil: null as Date | null,
  active: true,
  stripeCouponId: 'cp_1' as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('discountService', () => {
  describe('normalizeCode', () => {
    it('normalizes codes by trim + uppercase before lookup', () => {
      expect(discountService.normalizeCode('  save10  ')).toBe('SAVE10');
    });

    it('rejects malformed codes with null (INVALID_FORMAT at validate layer)', () => {
      expect(discountService.normalizeCode('ab')).toBeNull();
      expect(discountService.normalizeCode('bad!')).toBeNull();
    });
  });

  describe('computeDiscountCents', () => {
    it('floors percentage discounts', () => {
      expect(discountService.computeDiscountCents('PERCENTAGE', 10, 4001)).toBe(400);
      expect(discountService.computeDiscountCents('PERCENTAGE', 10, 4000)).toBe(400);
    });

    it('caps fixed discounts at subtotal', () => {
      expect(discountService.computeDiscountCents('FIXED', 5000, 2000)).toBe(2000);
    });

    it('returns zero product discount for FREE_SHIPPING', () => {
      expect(discountService.computeDiscountCents('FREE_SHIPPING', 0, 5000)).toBe(0);
    });
  });

  describe('validate', () => {
    it('returns INVALID_FORMAT when normalize fails', async () => {
      const r = await discountService.validate('x', 'u1', 1000);
      expect(r).toEqual({ ok: false, reason: 'INVALID_FORMAT' });
    });

    it('rejects unknown codes with NOT_FOUND', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue(null);
      const r = await discountService.validate('UNKNOWN', 'u1', 1000);
      expect(r).toEqual({ ok: false, reason: 'NOT_FOUND' });
    });

    it('rejects inactive discounts with INACTIVE', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue({
        ...baseDiscountRow,
        active: false,
      } as never);
      const r = await discountService.validate('SAVE10', 'u1', 1000);
      expect(r).toEqual({ ok: false, reason: 'INACTIVE' });
    });

    it('rejects NOT_STARTED', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue({
        ...baseDiscountRow,
        validFrom: new Date(Date.now() + 86_400_000),
      } as never);
      const r = await discountService.validate('SAVE10', 'u1', 1000);
      expect(r).toEqual({ ok: false, reason: 'NOT_STARTED' });
    });

    it('rejects EXPIRED', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue({
        ...baseDiscountRow,
        validUntil: new Date(Date.now() - 1000),
      } as never);
      const r = await discountService.validate('SAVE10', 'u1', 1000);
      expect(r).toEqual({ ok: false, reason: 'EXPIRED' });
    });

    it('rejects MIN_CART_NOT_MET', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue({
        ...baseDiscountRow,
        minCartCents: 5000,
      } as never);
      const r = await discountService.validate('SAVE10', 'u1', 1000);
      expect(r).toEqual({ ok: false, reason: 'MIN_CART_NOT_MET' });
    });

    it('rejects MAX_REDEMPTIONS_REACHED', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue({
        ...baseDiscountRow,
        maxRedemptions: 1,
        usedCount: 1,
      } as never);
      const r = await discountService.validate('SAVE10', 'u1', 10000);
      expect(r).toEqual({ ok: false, reason: 'MAX_REDEMPTIONS_REACHED' });
    });

    it('rejects ALREADY_USED', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue(baseDiscountRow as never);
      vi.mocked(prisma.discountUsage.findUnique).mockResolvedValue({ id: 'du' } as never);
      const r = await discountService.validate('SAVE10', 'u1', 10000);
      expect(r).toEqual({ ok: false, reason: 'ALREADY_USED' });
    });

    it('validates percentage discounts when all rules pass', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue(baseDiscountRow as never);
      vi.mocked(prisma.discountUsage.findUnique).mockResolvedValue(null);
      const r = await discountService.validate('SAVE10', 'u1', 4000);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.discount.discountCents).toBe(400);
      }
    });
  });

  describe('createDiscount', () => {
    it('creates Stripe coupon for percentage discounts', async () => {
      mStripe.coupons.create.mockResolvedValue({ id: 'cp_pct' });
      vi.mocked(prisma.discount.create).mockResolvedValue({
        ...baseDiscountRow,
        stripeCouponId: 'cp_pct',
      } as never);

      await discountService.createDiscount({
        code: 'pct1',
        type: 'PERCENTAGE',
        value: 15,
      });

      expect(mStripe.coupons.create).toHaveBeenCalledWith(
        expect.objectContaining({
          percent_off: 15,
          duration: 'once',
        }),
      );
    });

    it('creates Stripe coupon for fixed discounts', async () => {
      mStripe.coupons.create.mockResolvedValue({ id: 'cp_fixed' });
      vi.mocked(prisma.discount.create).mockResolvedValue({
        ...baseDiscountRow,
        type: 'FIXED',
        stripeCouponId: 'cp_fixed',
      } as never);

      await discountService.createDiscount({
        code: 'fix1',
        type: 'FIXED',
        value: 500,
      });

      expect(mStripe.coupons.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount_off: 500,
          currency: 'cad',
        }),
      );
    });

    it('passes max_redemptions and redeem_by when set', async () => {
      mStripe.coupons.create.mockResolvedValue({ id: 'cp_limited' });
      vi.mocked(prisma.discount.create).mockResolvedValue(baseDiscountRow as never);
      const until = new Date('2030-01-01T00:00:00Z');
      await discountService.createDiscount({
        code: 'lim1',
        type: 'PERCENTAGE',
        value: 5,
        maxRedemptions: 10,
        validUntil: until,
      });
      expect(mStripe.coupons.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_redemptions: 10,
          redeem_by: Math.floor(until.getTime() / 1000),
        }),
      );
    });

    it('does not create Stripe coupon for free shipping discounts', async () => {
      vi.mocked(prisma.discount.create).mockResolvedValue({
        ...baseDiscountRow,
        type: 'FREE_SHIPPING',
        value: 0,
        stripeCouponId: null,
      } as never);

      await discountService.createDiscount({
        code: 'ship',
        type: 'FREE_SHIPPING',
        value: 0,
      });
      expect(mStripe.coupons.create).not.toHaveBeenCalled();
    });

    it('throws StripeCouponRejectedError when Stripe fails', async () => {
      mStripe.coupons.create.mockRejectedValue(new Error('stripe down'));
      await expect(
        discountService.createDiscount({ code: 'bad', type: 'PERCENTAGE', value: 10 }),
      ).rejects.toThrow(discountService.StripeCouponRejectedError);
    });

    it('throws HTTPException on invalid code format', async () => {
      await expect(
        discountService.createDiscount({ code: '!!', type: 'PERCENTAGE', value: 10 }),
      ).rejects.toThrow(HTTPException);
    });
  });

  describe('applyToOrder', () => {
    it('is idempotent when usage already exists for the order', async () => {
      const tx = {
        discountUsage: {
          findFirst: vi.fn().mockResolvedValue({ id: 'x' }),
          findUnique: vi.fn(),
          create: vi.fn(),
        },
        order: {
          findUnique: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };
      const r = await discountService.applyToOrder('d1', 'o1', tx as never);
      expect(r).toEqual({ applied: true });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('returns MAX_REDEMPTIONS_REACHED when atomic increment affects 0 rows', async () => {
      const tx = {
        discountUsage: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        order: { findUnique: vi.fn().mockResolvedValue({ userId: 'u1' }) },
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      const r = await discountService.applyToOrder('d1', 'o1', tx as never);
      expect(r).toEqual({ applied: false, reason: 'MAX_REDEMPTIONS_REACHED' });
    });

    it('returns ALREADY_USED when user already redeemed', async () => {
      const tx = {
        discountUsage: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn().mockResolvedValue({ id: 'prior' }),
          create: vi.fn(),
        },
        order: { findUnique: vi.fn().mockResolvedValue({ userId: 'u1' }) },
        $executeRaw: vi.fn(),
      };
      const r = await discountService.applyToOrder('d1', 'o1', tx as never);
      expect(r).toEqual({ applied: false, reason: 'ALREADY_USED' });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('creates DiscountUsage after successful increment', async () => {
      const tx = {
        discountUsage: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
        order: { findUnique: vi.fn().mockResolvedValue({ userId: 'u1' }) },
        $executeRaw: vi.fn().mockResolvedValue(1),
      };
      const r = await discountService.applyToOrder('d1', 'o1', tx as never);
      expect(r).toEqual({ applied: true });
      expect(tx.discountUsage.create).toHaveBeenCalledWith({
        data: { discountId: 'd1', userId: 'u1', orderId: 'o1' },
      });
    });

    it('throws discount_redemption_failed on unique violation after increment', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
      const tx = {
        discountUsage: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockRejectedValue(err),
        },
        order: { findUnique: vi.fn().mockResolvedValue({ userId: 'u1' }) },
        $executeRaw: vi.fn().mockResolvedValue(1),
      };
      await expect(discountService.applyToOrder('d1', 'o1', tx as never)).rejects.toThrow(
        'discount_redemption_failed:ALREADY_USED',
      );
    });

    it('uses prisma.$transaction when tx omitted', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) =>
        (fn as (a: unknown) => unknown)({
          discountUsage: {
            findFirst: vi.fn().mockResolvedValue(null),
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
          },
          order: { findUnique: vi.fn().mockResolvedValue({ userId: 'u1' }) },
          $executeRaw: vi.fn().mockResolvedValue(1),
        }),
      );
      const r = await discountService.applyToOrder('d1', 'o1');
      expect(r.applied).toBe(true);
    });
  });

  describe('updateDiscount', () => {
    it('returns 404 when discount missing', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue(null);
      await expect(
        discountService.updateDiscount('missing', { active: false }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('updates allowed fields', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue(baseDiscountRow as never);
      vi.mocked(prisma.discount.update).mockResolvedValue({
        ...baseDiscountRow,
        value: 20,
        active: false,
      } as never);
      const r = await discountService.updateDiscount('d1', { value: 20, active: false });
      expect(r.value).toBe(20);
      expect(prisma.discount.update).toHaveBeenCalled();
    });

    it('rejects invalid percentage value on update', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue(baseDiscountRow as never);
      await expect(discountService.updateDiscount('d1', { value: 101 })).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('softDeleteDiscount', () => {
    it('deactivates an active discount', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue(baseDiscountRow as never);
      vi.mocked(prisma.discount.update).mockResolvedValue({
        ...baseDiscountRow,
        active: false,
      } as never);
      const r = await discountService.softDeleteDiscount('d1');
      expect(r.active).toBe(false);
    });

    it('is idempotent when already inactive', async () => {
      vi.mocked(prisma.discount.findUnique).mockResolvedValue({
        ...baseDiscountRow,
        active: false,
      } as never);
      const r = await discountService.softDeleteDiscount('d1');
      expect(r.active).toBe(false);
      expect(prisma.discount.update).not.toHaveBeenCalled();
    });
  });

  describe('listDiscounts', () => {
    it('paginates', async () => {
      vi.mocked(prisma.discount.count).mockResolvedValue(5);
      vi.mocked(prisma.discount.findMany).mockResolvedValue([baseDiscountRow] as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (arg: unknown) =>
        Promise.all(arg as Promise<unknown>[]),
      );
      const r = await discountService.listDiscounts({ page: 1, limit: 10 });
      expect(r.total).toBe(5);
      expect(r.data).toHaveLength(1);
    });
  });
});
