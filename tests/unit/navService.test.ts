import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { NavLocation } from '@prisma/client';

const tx = {
  navLink: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  footerColumn: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  categoryStripItem: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
};

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    navLink: {
      findMany: vi.fn(),
    },
    footerColumn: {
      findMany: vi.fn(),
    },
    categoryStripItem: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
  },
}));

vi.mock('../../src/services/revalidationService.js', () => ({
  revalidateFrontendTags: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma.js';
import * as navService from '../../src/services/navService.js';
import * as categoryStripService from '../../src/services/categoryStripService.js';
import { revalidateFrontendTags } from '../../src/services/revalidationService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('navService.replaceHeaderNav', () => {
  it('rejects duplicate positions', async () => {
    await expect(
      navService.replaceHeaderNav([
        { label: 'A', href: '/a', position: 0 },
        { label: 'B', href: '/b', position: 0 },
      ]),
    ).rejects.toBeInstanceOf(HTTPException);
  });

  it('replaces header links and revalidates', async () => {
    vi.mocked(prisma.navLink.findMany)
      .mockResolvedValueOnce([
        { label: 'Shop', href: '/products', position: 0, columnKey: null },
      ] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.footerColumn.findMany).mockResolvedValue([] as never);

    const result = await navService.replaceHeaderNav([
      { label: 'Shop', href: '/products', position: 0 },
    ]);

    expect(tx.navLink.deleteMany).toHaveBeenCalledWith({ where: { location: NavLocation.HEADER } });
    expect(revalidateFrontendTags).toHaveBeenCalledWith(['site-nav']);
    expect(result.header).toHaveLength(1);
  });
});

describe('navService.replaceFooterNav', () => {
  it('rejects duplicate link positions within a column', async () => {
    await expect(
      navService.replaceFooterNav([
        {
          column: { key: 'shop', label: 'Shop', position: 0 },
          links: [
            { label: 'A', href: '/a', position: 0 },
            { label: 'B', href: '/b', position: 0 },
          ],
        },
      ]),
    ).rejects.toBeInstanceOf(HTTPException);
  });
});

describe('categoryStripService.replaceCategoryStrip', () => {
  it('rejects duplicate positions', async () => {
    await expect(
      categoryStripService.replaceCategoryStrip([
        { label: 'Dogs', href: '/products?category=DOG', position: 0 },
        { label: 'Cats', href: '/products?category=CAT', position: 0 },
      ]),
    ).rejects.toBeInstanceOf(HTTPException);
  });

  it('replaces all items and revalidates', async () => {
    vi.mocked(prisma.categoryStripItem.findMany).mockResolvedValue([
      {
        id: 'new-1',
        label: 'Dogs',
        imageUrl: null,
        href: '/products?category=DOG',
        position: 0,
        isActive: true,
      },
    ] as never);

    const result = await categoryStripService.replaceCategoryStrip([
      { label: 'Dogs', href: '/products?category=DOG', position: 0 },
    ]);

    expect(tx.categoryStripItem.deleteMany).toHaveBeenCalled();
    expect(revalidateFrontendTags).toHaveBeenCalledWith(['site-category-strip']);
    expect(result).toHaveLength(1);
  });
});
