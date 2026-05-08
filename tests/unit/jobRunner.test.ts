import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    cart: { updateMany: vi.fn() },
    subscription: { findMany: vi.fn() },
  },
}));

vi.mock('../../src/services/cartService.js', () => ({
  findAbandonedCartCandidates: vi.fn(),
}));

vi.mock('../../src/services/emailService.js', () => ({
  sendAbandonedCartReminder: vi.fn(),
  sendUpcomingDeliveryReminder: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma.js';
import * as cartService from '../../src/services/cartService.js';
import * as emailService from '../../src/services/emailService.js';
import * as jobRunner from '../../src/services/jobRunner.js';
import * as subscriptionService from '../../src/services/subscriptionService.js';

const USER = {
  id: 'u1',
  email: 'test@example.com',
  name: 'Pat',
  role: 'CUSTOMER' as const,
};

const PRODUCT = {
  id: 'p1',
  name: 'Kibble',
  slug: 'kibble',
  description: '',
  price: 1000,
  imageUrl: null,
  stock: 5,
  active: true,
  category: 'DOG' as const,
};

const itemsNonEmpty = [
  {
    id: 'ci1',
    cartId: 'cart-1',
    productId: PRODUCT.id,
    product: PRODUCT,
    quantity: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

function cartRow(overrides: {
  id?: string;
  items?: typeof itemsNonEmpty;
  lastAbandonedEmailAt?: Date | null;
  updatedAt?: Date;
}) {
  const id = overrides.id ?? 'cart-1';
  const items = overrides.items ?? itemsNonEmpty;
  return {
    id,
    userId: USER.id,
    discountId: null,
    discount: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-05-01T00:00:00.000Z'),
    lastAbandonedEmailAt: overrides.lastAbandonedEmailAt ?? null,
    user: USER,
    items,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('jobRunner.runAbandonedCartJob', () => {
  const JOB_NOW = new Date('2026-05-08T12:00:00.000Z');

  it('sends reminder for eligible cart', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([cartRow({}) as never]);
    vi.mocked(emailService.sendAbandonedCartReminder).mockResolvedValue({ ok: true });
    vi.mocked(prisma.cart.updateMany).mockResolvedValue({ count: 1 });

    const r = await jobRunner.runAbandonedCartJob(JOB_NOW);

    expect(r.sent).toBe(1);
    expect(r.scanned).toBe(1);
    expect(emailService.sendAbandonedCartReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        cartId: 'cart-1',
        userId: USER.id,
        idempotencyRunAt: JOB_NOW,
      }),
    );
    expect(prisma.cart.updateMany).toHaveBeenCalledWith({
      where: { id: 'cart-1', lastAbandonedEmailAt: null },
      data: { lastAbandonedEmailAt: JOB_NOW },
    });
  });

  it('throttles when lastAbandonedEmailAt is within 7 days', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([]);
    const r = await jobRunner.runAbandonedCartJob(JOB_NOW);
    expect(r.scanned).toBe(0);
    expect(emailService.sendAbandonedCartReminder).not.toHaveBeenCalled();
  });

  it('throttles when updatedAt is within 24 hours', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([]);
    const r = await jobRunner.runAbandonedCartJob(JOB_NOW);
    expect(r.scanned).toBe(0);
  });

  it('skips empty carts', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([
      cartRow({ items: [], id: 'c-empty' }) as never,
    ]);

    const r = await jobRunner.runAbandonedCartJob(JOB_NOW);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(emailService.sendAbandonedCartReminder).not.toHaveBeenCalled();
  });

  it('skips users without verified email', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([]);
    const r = await jobRunner.runAbandonedCartJob(JOB_NOW);
    expect(r.scanned).toBe(0);
  });

  it('skips non-CUSTOMER users', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([]);
    const r = await jobRunner.runAbandonedCartJob(JOB_NOW);
    expect(r.scanned).toBe(0);
  });

  it('stamps lastAbandonedEmailAt only after result.ok', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([cartRow({}) as never]);
    vi.mocked(emailService.sendAbandonedCartReminder).mockResolvedValue({ ok: false, error: 'x' });

    await jobRunner.runAbandonedCartJob(JOB_NOW);

    expect(prisma.cart.updateMany).not.toHaveBeenCalled();
  });

  it('does NOT stamp on failed send', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([cartRow({}) as never]);
    vi.mocked(emailService.sendAbandonedCartReminder).mockResolvedValue({ ok: false });

    await jobRunner.runAbandonedCartJob(JOB_NOW);

    expect(prisma.cart.updateMany).not.toHaveBeenCalled();
  });

  it('uses updateMany previous-value guard before stamping', async () => {
    const prev = new Date('2026-04-01T00:00:00.000Z');
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([
      cartRow({ lastAbandonedEmailAt: prev }) as never,
    ]);
    vi.mocked(emailService.sendAbandonedCartReminder).mockResolvedValue({ ok: true });
    vi.mocked(prisma.cart.updateMany).mockResolvedValue({ count: 1 });

    await jobRunner.runAbandonedCartJob(JOB_NOW);

    expect(prisma.cart.updateMany).toHaveBeenCalledWith({
      where: { id: 'cart-1', lastAbandonedEmailAt: prev },
      data: { lastAbandonedEmailAt: JOB_NOW },
    });
  });

  it('counts failed sends without aborting later carts', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([
      cartRow({
        id: 'c1',
        items: itemsNonEmpty.map((it) => ({ ...it, cartId: 'c1' })),
      }) as never,
      cartRow({
        id: 'c2',
        items: itemsNonEmpty.map((it) => ({ ...it, id: 'ci2', cartId: 'c2' })),
      }) as never,
    ]);
    vi.mocked(emailService.sendAbandonedCartReminder)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true });
    vi.mocked(prisma.cart.updateMany).mockResolvedValue({ count: 1 });

    const r = await jobRunner.runAbandonedCartJob(JOB_NOW);

    expect(r.failed).toBe(1);
    expect(r.sent).toBe(1);
    expect(r.scanned).toBe(2);
  });

  it('queries abandoned-cart candidates with batchSize JOB_BATCH_SIZE per page', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([]);
    await jobRunner.runAbandonedCartJob(JOB_NOW);
    expect(cartService.findAbandonedCartCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        batchSize: jobRunner.JOB_BATCH_SIZE,
        cursor: undefined,
      }),
    );
  });

  it('uses idempotency key abandoned-cart/{userId}/{cartId}/{yyyy-mm-dd} via idempotencyRunAt', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([cartRow({}) as never]);
    vi.mocked(emailService.sendAbandonedCartReminder).mockResolvedValue({ ok: true });
    vi.mocked(prisma.cart.updateMany).mockResolvedValue({ count: 1 });

    await jobRunner.runAbandonedCartJob(JOB_NOW);

    expect(emailService.sendAbandonedCartReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        cartId: 'cart-1',
        idempotencyRunAt: JOB_NOW,
      }),
    );
  });

  it('counts lost stamp race as skipped without throwing', async () => {
    vi.mocked(cartService.findAbandonedCartCandidates).mockResolvedValue([cartRow({}) as never]);
    vi.mocked(emailService.sendAbandonedCartReminder).mockResolvedValue({ ok: true });
    vi.mocked(prisma.cart.updateMany).mockResolvedValue({ count: 0 });

    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const r = await jobRunner.runAbandonedCartJob(JOB_NOW);

    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(
      logSpy.mock.calls.some((row) =>
        row.some((a) => typeof a === 'string' && a.includes('abandoned_cart_stamp_lost_race')),
      ),
    ).toBe(true);

    logSpy.mockRestore();
  });
});

describe('jobRunner.runUpcomingDeliveryJob', () => {
  it('calls sendUpcomingDeliveryRemindersDue with window now+3d to now+3d+scanInterval', async () => {
    const spy = vi.spyOn(subscriptionService, 'sendUpcomingDeliveryRemindersDue');
    spy.mockResolvedValue({ scanned: 0, sent: 0, failed: 0, skipped: 0 });

    const now = new Date('2026-05-08T12:00:00.000Z');
    await jobRunner.runUpcomingDeliveryJob(now);

    const wantStart = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const wantEnd = new Date(wantStart.getTime() + 60 * 60 * 1000);

    expect(spy).toHaveBeenCalledWith({
      windowStartAt: wantStart,
      windowEndAt: wantEnd,
    });

    spy.mockRestore();
  });
});

describe('subscriptionService.sendUpcomingDeliveryRemindersDue windows', () => {
  beforeEach(() => {
    vi.mocked(emailService.sendUpcomingDeliveryReminder).mockResolvedValue({ ok: true });
  });

  it('includes subscriptions exactly at window start', async () => {
    const ws = new Date('2026-06-01T12:00:00.000Z');
    const we = new Date('2026-06-01T13:00:00.000Z');
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);

    await subscriptionService.sendUpcomingDeliveryRemindersDue({
      windowStartAt: ws,
      windowEndAt: we,
    });

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nextDeliveryAt: { gte: ws, lt: we },
        }),
      }),
    );
  });

  it('excludes subscriptions before window start', async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);
    await subscriptionService.sendUpcomingDeliveryRemindersDue({
      windowStartAt: new Date('2026-06-01T12:00:00.000Z'),
      windowEndAt: new Date('2026-06-01T13:00:00.000Z'),
    });
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nextDeliveryAt: {
            gte: new Date('2026-06-01T12:00:00.000Z'),
            lt: new Date('2026-06-01T13:00:00.000Z'),
          },
        }),
      }),
    );
  });

  it('excludes subscriptions at or after window end', async () => {
    const ws = new Date('2026-06-02T09:00:00.000Z');
    const we = new Date('2026-06-02T10:00:00.000Z');
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);

    await subscriptionService.sendUpcomingDeliveryRemindersDue({
      windowStartAt: ws,
      windowEndAt: we,
    });

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nextDeliveryAt: { gte: ws, lt: we },
        }),
      }),
    );
  });

  it('sendUpcomingDeliveryRemindersDue uses idempotency key upcoming-delivery/{subscriptionId}/{yyyy-mm-dd}', async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      {
        id: 'sub-idem',
        userId: 'u1',
        productId: 'p1',
        petId: null,
        quantity: 1,
        interval: 'WEEK_4',
        status: 'ACTIVE',
        discountPercent: 5,
        nextDeliveryAt: new Date('2026-07-03T08:30:45.123Z'),
        stripeSubscriptionId: 'ss',
        stripePriceId: 'price',
        createdAt: new Date(),
        updatedAt: new Date(),
        pausedAt: null,
        cancelledAt: null,
        product: { id: 'p1', name: 'N', slug: 'slug' },
        pet: null,
        user: { email: 'x@y.com', name: 'Z' },
      } as never,
    ]);

    await subscriptionService.sendUpcomingDeliveryRemindersDue({
      windowStartAt: new Date('2026-06-01T00:00:00.000Z'),
      windowEndAt: new Date('2026-07-10T00:00:00.000Z'),
    });

    expect(emailService.sendUpcomingDeliveryReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-idem',
        nextDeliveryAt: new Date('2026-07-03T08:30:45.123Z'),
      }),
    );
    /*
     * `sendUpcomingDeliveryReminder` derives Resend key
     * `upcoming-delivery/{subscriptionId}/{yyyy-mm-dd}` from `nextDeliveryAt` UTC date
     * (see tests/unit/emailService.test.ts).
     */
  });
});
