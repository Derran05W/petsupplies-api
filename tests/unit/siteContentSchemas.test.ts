import { describe, it, expect } from 'vitest';
import {
  navHrefSchema,
  navLinkInputSchema,
  replaceFeaturedProductsSchema,
  replaceHeaderNavSchema,
  replaceFooterNavSchema,
  replaceCategoryStripSchema,
  assertUniquePositions,
} from '../../src/schemas/siteContent.js';

describe('navHrefSchema', () => {
  it('accepts relative paths', () => {
    expect(navHrefSchema.safeParse('/products').success).toBe(true);
  });

  it('accepts hash links', () => {
    expect(navHrefSchema.safeParse('#categories').success).toBe(true);
  });

  it('accepts absolute URLs', () => {
    expect(navHrefSchema.safeParse('https://example.com/x').success).toBe(true);
  });

  it('accepts mailto links', () => {
    expect(navHrefSchema.safeParse('mailto:support@example.com').success).toBe(true);
  });

  it('rejects invalid href', () => {
    expect(navHrefSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });
});

describe('replaceFeaturedProductsSchema', () => {
  it('allows up to 8 product IDs', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `prod-${i}`);
    expect(replaceFeaturedProductsSchema.safeParse({ productIds: ids }).success).toBe(true);
  });

  it('rejects more than 8 product IDs', () => {
    const ids = Array.from({ length: 9 }, (_, i) => `prod-${i}`);
    expect(replaceFeaturedProductsSchema.safeParse({ productIds: ids }).success).toBe(false);
  });
});

describe('replaceHeaderNavSchema', () => {
  it('rejects empty labels', () => {
    expect(
      replaceHeaderNavSchema.safeParse([{ label: '', href: '/products', position: 0 }]).success,
    ).toBe(false);
  });

  it('rejects invalid href', () => {
    expect(
      replaceHeaderNavSchema.safeParse([{ label: 'Shop', href: 'ftp://bad', position: 0 }]).success,
    ).toBe(false);
  });
});

describe('replaceFooterNavSchema', () => {
  it('requires at least one column', () => {
    expect(replaceFooterNavSchema.safeParse([]).success).toBe(false);
  });

  it('accepts valid footer payload', () => {
    expect(
      replaceFooterNavSchema.safeParse([
        {
          column: { key: 'shop', label: 'Shop', position: 0 },
          links: [{ label: 'All', href: '/products', position: 0 }],
        },
      ]).success,
    ).toBe(true);
  });
});

describe('replaceCategoryStripSchema', () => {
  it('accepts valid items', () => {
    expect(
      replaceCategoryStripSchema.safeParse([
        { label: 'Dogs', href: '/products?category=DOG', position: 0 },
      ]).success,
    ).toBe(true);
  });
});

describe('assertUniquePositions', () => {
  it('throws on duplicate positions', () => {
    expect(() => assertUniquePositions([{ position: 0 }, { position: 0 }], 'test')).toThrow(
      /Duplicate position/,
    );
  });
});

describe('navLinkInputSchema', () => {
  it('trims labels', () => {
    const parsed = navLinkInputSchema.parse({ label: '  Shop  ', href: '/products', position: 0 });
    expect(parsed.label).toBe('Shop');
  });
});
