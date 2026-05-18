import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanadaPostClientError } from '../../src/services/canadaPostClient.js';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    cart: { findUnique: vi.fn() },
    address: { findFirst: vi.fn() },
  },
}));

vi.mock('../../src/services/canadaPostClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/canadaPostClient.js')>();
  return {
    ...actual,
    requestCanadaPostRates: vi.fn(),
  };
});

vi.mock('../../src/services/discountService.js', () => ({
  validateById: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma.js';
import { requestCanadaPostRates } from '../../src/services/canadaPostClient.js';
import * as discountService from '../../src/services/discountService.js';
import * as shippingService from '../../src/services/shippingService.js';

const productRow = {
  id: 'p1',
  name: 'Dog Food',
  slug: 'dog-food',
  price: 2000,
  imageUrl: null,
  stock: 10,
  active: true,
  weightGrams: null as number | null,
  lengthCm: null as number | null,
  widthCm: null as number | null,
  heightCm: null as number | null,
  shipsSeparately: false,
};

const cartItem = {
  id: 'ci1',
  cartId: 'c1',
  productId: 'p1',
  quantity: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
  product: productRow,
};

const inlineDest = {
  postalCode: 'K1A 0A1',
  country: 'CA' as const,
  line1: '1 Main',
  city: 'Ottawa',
  region: 'ON',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(discountService.validateById).mockResolvedValue({ ok: false, reason: 'NOT_FOUND' });
});

describe('shippingService.cartFingerprintFromItems', () => {
  it('is stable for sorted product ids', () => {
    const a = shippingService.cartFingerprintFromItems([
      { productId: 'b', quantity: 1 },
      { productId: 'a', quantity: 2 },
    ]);
    const b = shippingService.cartFingerprintFromItems([
      { productId: 'a', quantity: 2 },
      { productId: 'b', quantity: 1 },
    ]);
    expect(a).toBe(b);
  });
});

describe('shippingService.quoteForCart', () => {
  it('throws 400 when cart empty', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue(null);
    await expect(shippingService.quoteForCart('u1', inlineDest)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('returns threshold free shipping without calling Canada Post', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      discountId: null,
      discount: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          ...cartItem,
          product: { ...productRow, price: 4000 },
          quantity: 2,
        },
      ],
    } as never);

    const r = await shippingService.quoteForCart('u1', inlineDest);
    expect(r.source).toBe('fallback');
    expect(r.options[0]?.amountCents).toBe(0);
    expect(requestCanadaPostRates).not.toHaveBeenCalled();
  });

  it('returns live rates when below threshold', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      discountId: null,
      discount: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [cartItem],
    } as never);
    vi.mocked(requestCanadaPostRates).mockResolvedValue([
      { serviceCode: 'DOM.EP', serviceName: 'Expedited', amountCents: 888 },
      { serviceCode: 'DOM.RP', serviceName: 'Regular', amountCents: 500 },
    ]);

    const r = await shippingService.quoteForCart('u1', inlineDest);
    expect(r.source).toBe('canada_post');
    expect(r.options.length).toBeGreaterThanOrEqual(1);
    expect(r.options[0]?.serviceCode).toBe('DOM.RP');
  });

  it('falls back when Canada Post fails', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      discountId: null,
      discount: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [cartItem],
    } as never);
    vi.mocked(requestCanadaPostRates).mockRejectedValue(
      new CanadaPostClientError('CP_TIMEOUT', 'timeout'),
    );

    const r = await shippingService.quoteForCart('u1', inlineDest);
    expect(r.source).toBe('fallback');
    expect(r.options[0]?.amountCents).toBe(599);
  });

  it('loads destination from addressId', async () => {
    vi.mocked(prisma.address.findFirst).mockResolvedValue({
      id: 'addr1',
      userId: 'u1',
      line1: 'x',
      line2: null,
      city: 'T',
      region: 'ON',
      postalCode: 'M5V 3A8',
      country: 'CA',
      label: null,
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      discountId: null,
      discount: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          ...cartItem,
          product: { ...productRow, price: 4000 },
          quantity: 2,
        },
      ],
    } as never);

    const r = await shippingService.quoteForCart('u1', { addressId: 'addr1' });
    expect(r.options[0]?.amountCents).toBe(0);
    expect(prisma.address.findFirst).toHaveBeenCalled();
  });

  it('short-circuits for FREE_SHIPPING coupon', async () => {
    vi.mocked(discountService.validateById).mockResolvedValue({
      ok: true,
      discount: {
        discountId: 'd1',
        code: 'FREESHIP',
        type: 'FREE_SHIPPING',
        value: 0,
        discountCents: 0,
        shippingDiscountCents: 599,
        stripeCouponId: null,
      },
    });
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      discountId: 'd1',
      discount: { id: 'd1' },
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [cartItem],
    } as never);

    const r = await shippingService.quoteForCart('u1', inlineDest);
    expect(r.source).toBe('fallback');
    expect(r.options[0]?.amountCents).toBe(0);
    expect(requestCanadaPostRates).not.toHaveBeenCalled();
  });

  it('throws 404 when addressId not found', async () => {
    vi.mocked(prisma.address.findFirst).mockResolvedValue(null);
    await expect(
      shippingService.quoteForCart('u1', { addressId: 'c123456789012345678901234' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('merges Canada Post rates when shipsSeparately splits parcels', async () => {
    vi.mocked(prisma.cart.findUnique).mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      discountId: null,
      discount: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          ...cartItem,
          id: 'i1',
          productId: 'p1',
          product: { ...productRow, id: 'p1', shipsSeparately: true },
          quantity: 1,
        },
        {
          ...cartItem,
          id: 'i2',
          productId: 'p2',
          product: {
            ...productRow,
            id: 'p2',
            shipsSeparately: true,
            price: 1000,
          },
          quantity: 1,
        },
      ],
    } as never);
    vi.mocked(requestCanadaPostRates)
      .mockResolvedValueOnce([
        { serviceCode: 'DOM.EP', serviceName: 'Expedited', amountCents: 500 },
      ])
      .mockResolvedValueOnce([
        { serviceCode: 'DOM.EP', serviceName: 'Expedited', amountCents: 600 },
      ]);

    const r = await shippingService.quoteForCart('u1', inlineDest);
    expect(r.source).toBe('canada_post');
    expect(requestCanadaPostRates).toHaveBeenCalledTimes(2);
    const merged = r.options.find((o) => o.serviceCode === 'DOM.EP');
    expect(merged?.amountCents).toBe(1100);
  });
});
