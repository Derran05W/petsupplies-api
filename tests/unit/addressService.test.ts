import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    address: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as addressService from '../../src/services/addressService.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const addr1 = {
  id: 'addr-1',
  userId: 'user-1',
  label: 'Home',
  line1: '123 Main St',
  line2: null,
  city: 'Toronto',
  region: 'ON',
  postalCode: 'M5V 3A8',
  country: 'CA',
  isDefault: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const addr2 = {
  ...addr1,
  id: 'addr-2',
  label: 'Work',
  isDefault: false,
  createdAt: new Date('2026-01-02'),
};

const createInput = {
  line1: '456 Other St',
  city: 'Vancouver',
  region: 'BC',
  postalCode: 'V6B 1A1',
  country: 'CA' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── createAddress ─────────────────────────────────────────────────────────────

describe('addressService.createAddress', () => {
  it('forces isDefault=true for the first address', async () => {
    vi.mocked(prisma.address.count).mockResolvedValue(0);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        address: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ ...addr1, ...createInput, isDefault: true }),
        },
      };
      return fn(tx as never);
    });

    const result = await addressService.createAddress('user-1', createInput);

    expect(result.isDefault).toBe(true);
  });

  it('unsets existing defaults transactionally when isDefault: true is requested', async () => {
    vi.mocked(prisma.address.count).mockResolvedValue(1);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({ ...addr2, isDefault: true });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({ address: { updateMany, create } } as never);
    });

    await addressService.createAddress('user-1', { ...createInput, isDefault: true });

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDefault: true },
      data: { isDefault: false },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }),
    );
  });

  it('creates non-default address when isDefault is false and addresses already exist', async () => {
    vi.mocked(prisma.address.count).mockResolvedValue(2);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const create = vi.fn().mockResolvedValue({ ...addr2, isDefault: false });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({ address: { updateMany, create } } as never);
    });

    await addressService.createAddress('user-1', { ...createInput, isDefault: false });

    // updateMany should still be called but won't match anything since makeDefault is false
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDefault: false }) }),
    );
  });
});

// ── updateAddress ─────────────────────────────────────────────────────────────

describe('addressService.updateAddress', () => {
  it('throws 404 when address not owned by user', async () => {
    vi.mocked(prisma.address.findFirst).mockResolvedValue(null);

    await expect(
      addressService.updateAddress('user-1', 'addr-other', { line1: 'New' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('unsets existing defaults when setting new default', async () => {
    vi.mocked(prisma.address.findFirst).mockResolvedValue(addr2 as never);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({ ...addr2, isDefault: true });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({ address: { updateMany, update } } as never);
    });

    await addressService.updateAddress('user-1', 'addr-2', { isDefault: true });

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDefault: true },
      data: { isDefault: false },
    });
  });

  it('ignores isDefault: false on the current default address', async () => {
    vi.mocked(prisma.address.findFirst).mockResolvedValue(addr1 as never);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const update = vi.fn().mockResolvedValue(addr1);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({ address: { updateMany, update } } as never);
    });

    await addressService.updateAddress('user-1', 'addr-1', { isDefault: false });

    // Should not call updateMany to clear defaults
    expect(updateMany).not.toHaveBeenCalled();
    // isDefault in the update call should be the existing value (true), not false
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: true }),
      }),
    );
  });
});

// ── deleteAddress ─────────────────────────────────────────────────────────────

describe('addressService.deleteAddress', () => {
  it('throws 404 when address not owned by user', async () => {
    vi.mocked(prisma.address.findFirst).mockResolvedValue(null);

    await expect(addressService.deleteAddress('user-1', 'addr-x')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('auto-promotes the oldest remaining address when deleting the default', async () => {
    vi.mocked(prisma.address.findFirst).mockResolvedValue(addr1 as never);
    const txDelete = vi.fn().mockResolvedValue({});
    const txFindFirst = vi.fn().mockResolvedValue({ id: 'addr-2' });
    const txUpdate = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        address: { delete: txDelete, findFirst: txFindFirst, update: txUpdate },
      } as never);
    });

    await addressService.deleteAddress('user-1', 'addr-1');

    expect(txDelete).toHaveBeenCalledWith({ where: { id: 'addr-1' } });
    expect(txFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: 'addr-2' },
      data: { isDefault: true },
    });
  });

  it('does not promote when no remaining addresses after delete', async () => {
    vi.mocked(prisma.address.findFirst).mockResolvedValue(addr1 as never);
    const txDelete = vi.fn().mockResolvedValue({});
    const txFindFirst = vi.fn().mockResolvedValue(null);
    const txUpdate = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        address: { delete: txDelete, findFirst: txFindFirst, update: txUpdate },
      } as never);
    });

    await addressService.deleteAddress('user-1', 'addr-1');

    expect(txUpdate).not.toHaveBeenCalled();
  });
});

// ── setDefaultAddress ─────────────────────────────────────────────────────────

describe('addressService.setDefaultAddress', () => {
  it('throws 404 when address not owned', async () => {
    vi.mocked(prisma.address.findFirst).mockResolvedValue(null);

    await expect(addressService.setDefaultAddress('user-1', 'addr-x')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('unsets other defaults and sets target as default', async () => {
    vi.mocked(prisma.address.findFirst).mockResolvedValue(addr2 as never);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({ ...addr2, isDefault: true });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({ address: { updateMany, update } } as never);
    });

    const result = await addressService.setDefaultAddress('user-1', 'addr-2');

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDefault: true },
      data: { isDefault: false },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'addr-2' },
      data: { isDefault: true },
      select: expect.any(Object),
    });
    expect(result.isDefault).toBe(true);
  });
});
