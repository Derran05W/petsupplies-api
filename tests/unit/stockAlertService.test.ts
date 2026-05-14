import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const prismaMock = vi.hoisted(() => ({
  product: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  stockAlert: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../../src/services/emailService.js', () => ({
  sendBackInStockAlert: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma.js';
import { sendBackInStockAlert } from '../../src/services/emailService.js';
import * as stockAlertService from '../../src/services/stockAlertService.js';

const PID = `c${'a'.repeat(24)}`;
const UID = 'user-sub-1';

const productRow = {
  id: PID,
  name: 'Treats',
  slug: 'treats',
  price: 999,
  active: true,
  stock: 0,
  images: [] as never[],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('onProductBecameOutOfStock', () => {
  it('runs episode increment and clears notifiedAt in a transaction', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue(undefined);
    await stockAlertService.onProductBecameOutOfStock(PID);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = vi.mocked(prisma.$transaction).mock.calls[0]![0] as unknown[];
    expect(ops).toHaveLength(2);
  });
});

describe('dispatchBackInStockNotifications', () => {
  it('returns empty stats when product is missing', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    const r = await stockAlertService.dispatchBackInStockNotifications(PID);
    expect(r).toEqual({ attempted: 0, sent: 0, failed: 0, skipped: 0 });
  });

  it('returns empty stats when stock is zero', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      name: 'X',
      slug: 'x',
      stock: 0,
      active: true,
      stockAlertEpisode: 1,
    } as never);
    const r = await stockAlertService.dispatchBackInStockNotifications(PID);
    expect(r.attempted).toBe(0);
  });

  it('returns empty stats when product inactive', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      name: 'X',
      slug: 'x',
      stock: 3,
      active: false,
      stockAlertEpisode: 1,
    } as never);
    const r = await stockAlertService.dispatchBackInStockNotifications(PID);
    expect(r.attempted).toBe(0);
  });

  it('skips when fresh row already notified', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      name: 'X',
      slug: 'x',
      stock: 2,
      active: true,
      stockAlertEpisode: 2,
    } as never);
    vi.mocked(prisma.stockAlert.findMany).mockResolvedValue([
      {
        id: 'alert-1',
        userId: UID,
        productId: PID,
        createdAt: new Date(),
        notifiedAt: null,
        user: { email: 'a@b.com' },
      },
    ] as never);
    vi.mocked(prisma.stockAlert.findUnique).mockResolvedValue({ notifiedAt: new Date() } as never);

    const r = await stockAlertService.dispatchBackInStockNotifications(PID);
    expect(r.attempted).toBe(1);
    expect(r.skipped).toBe(1);
    expect(sendBackInStockAlert).not.toHaveBeenCalled();
  });

  it('skips when user has no email', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      name: 'X',
      slug: 'x',
      stock: 2,
      active: true,
      stockAlertEpisode: 1,
    } as never);
    vi.mocked(prisma.stockAlert.findMany).mockResolvedValue([
      {
        id: 'alert-1',
        userId: UID,
        productId: PID,
        createdAt: new Date(),
        notifiedAt: null,
        user: { email: '  ' },
      },
    ] as never);
    vi.mocked(prisma.stockAlert.findUnique).mockResolvedValue({ notifiedAt: null } as never);

    const r = await stockAlertService.dispatchBackInStockNotifications(PID);
    expect(r.skipped).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('counts failed when send returns not ok', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      name: 'X',
      slug: 'x',
      stock: 2,
      active: true,
      stockAlertEpisode: 4,
    } as never);
    vi.mocked(prisma.stockAlert.findMany).mockResolvedValue([
      {
        id: 'alert-1',
        userId: UID,
        productId: PID,
        createdAt: new Date(),
        notifiedAt: null,
        user: { email: 'a@b.com' },
      },
    ] as never);
    vi.mocked(prisma.stockAlert.findUnique).mockResolvedValue({ notifiedAt: null } as never);
    vi.mocked(sendBackInStockAlert).mockResolvedValue({ ok: false, error: 'down' });

    const r = await stockAlertService.dispatchBackInStockNotifications(PID);
    expect(r.failed).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stamps notifiedAt and counts sent on success', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      name: 'X',
      slug: 'x',
      stock: 2,
      active: true,
      stockAlertEpisode: 5,
    } as never);
    vi.mocked(prisma.stockAlert.findMany).mockResolvedValue([
      {
        id: 'alert-1',
        userId: UID,
        productId: PID,
        createdAt: new Date(),
        notifiedAt: null,
        user: { email: 'a@b.com' },
      },
    ] as never);
    vi.mocked(prisma.stockAlert.findUnique).mockResolvedValue({ notifiedAt: null } as never);
    vi.mocked(sendBackInStockAlert).mockResolvedValue({ ok: true });
    vi.mocked(prisma.stockAlert.updateMany).mockResolvedValue({ count: 1 });

    const r = await stockAlertService.dispatchBackInStockNotifications(PID);
    expect(r.sent).toBe(1);
    expect(sendBackInStockAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: UID,
        stockAlertEpisode: 5,
        productId: PID,
      }),
    );
  });

  it('counts skipped when stamp loses race after ok send', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      name: 'X',
      slug: 'x',
      stock: 2,
      active: true,
      stockAlertEpisode: 6,
    } as never);
    vi.mocked(prisma.stockAlert.findMany).mockResolvedValue([
      {
        id: 'alert-1',
        userId: UID,
        productId: PID,
        createdAt: new Date(),
        notifiedAt: null,
        user: { email: 'a@b.com' },
      },
    ] as never);
    vi.mocked(prisma.stockAlert.findUnique).mockResolvedValue({ notifiedAt: null } as never);
    vi.mocked(sendBackInStockAlert).mockResolvedValue({ ok: true });
    vi.mocked(prisma.stockAlert.updateMany).mockResolvedValue({ count: 0 });

    const r = await stockAlertService.dispatchBackInStockNotifications(PID);
    expect(r.skipped).toBe(1);
  });
});

describe('addStockAlert', () => {
  it('throws 404 when product missing', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
    await expect(stockAlertService.addStockAlert({ userId: UID, productId: PID })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws 409 PRODUCT_INACTIVE', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      stock: 0,
      active: false,
    } as never);
    await expect(stockAlertService.addStockAlert({ userId: UID, productId: PID })).rejects.toMatchObject({
      status: 409,
      message: 'PRODUCT_INACTIVE',
    });
  });

  it('throws 409 IN_STOCK when stock positive', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      stock: 3,
      active: true,
    } as never);
    await expect(stockAlertService.addStockAlert({ userId: UID, productId: PID })).rejects.toMatchObject({
      status: 409,
      message: 'IN_STOCK',
    });
  });

  it('throws 400 when at cap', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      stock: 0,
      active: true,
    } as never);
    vi.mocked(prisma.stockAlert.count).mockResolvedValue(500);
    await expect(stockAlertService.addStockAlert({ userId: UID, productId: PID })).rejects.toMatchObject({
      status: 400,
      message: 'STOCK_ALERTS_FULL',
    });
  });

  it('creates and returns created true', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      stock: 0,
      active: true,
    } as never);
    vi.mocked(prisma.stockAlert.count).mockResolvedValue(0);
    const row = {
      id: 'alert-new',
      userId: UID,
      productId: PID,
      createdAt: new Date(),
      notifiedAt: null,
      product: productRow,
    };
    vi.mocked(prisma.stockAlert.create).mockResolvedValue(row as never);

    const r = await stockAlertService.addStockAlert({ userId: UID, productId: PID });
    expect(r.created).toBe(true);
    expect(r.item.id).toBe('alert-new');
  });

  it('returns existing on P2002 duplicate', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      stock: 0,
      active: true,
    } as never);
    vi.mocked(prisma.stockAlert.count).mockResolvedValue(0);
    const dup = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    vi.mocked(prisma.stockAlert.create).mockRejectedValue(dup);
    const existing = {
      id: 'alert-ex',
      userId: UID,
      productId: PID,
      createdAt: new Date(),
      notifiedAt: null,
      product: productRow,
    };
    vi.mocked(prisma.stockAlert.findUnique).mockResolvedValue(existing as never);

    const r = await stockAlertService.addStockAlert({ userId: UID, productId: PID });
    expect(r.created).toBe(false);
    expect(r.item.id).toBe('alert-ex');
  });

  it('rethrows P2002 when existing row missing', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      id: PID,
      stock: 0,
      active: true,
    } as never);
    vi.mocked(prisma.stockAlert.count).mockResolvedValue(0);
    const dup = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    vi.mocked(prisma.stockAlert.create).mockRejectedValue(dup);
    vi.mocked(prisma.stockAlert.findUnique).mockResolvedValue(null);

    await expect(stockAlertService.addStockAlert({ userId: UID, productId: PID })).rejects.toBe(dup);
  });
});

describe('listStockAlerts', () => {
  it('paginates with oldest sort', async () => {
    vi.mocked(prisma.stockAlert.findMany).mockResolvedValue([]);
    vi.mocked(prisma.stockAlert.count).mockResolvedValue(0);

    await stockAlertService.listStockAlerts({
      userId: UID,
      page: 1,
      limit: 10,
      sort: 'oldest',
    });

    expect(prisma.stockAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'asc' },
      }),
    );
  });
});

describe('removeStockAlert', () => {
  it('calls deleteMany', async () => {
    vi.mocked(prisma.stockAlert.deleteMany).mockResolvedValue({ count: 1 });
    await stockAlertService.removeStockAlert({ userId: UID, productId: PID });
    expect(prisma.stockAlert.deleteMany).toHaveBeenCalledWith({
      where: { userId: UID, productId: PID },
    });
  });
});
