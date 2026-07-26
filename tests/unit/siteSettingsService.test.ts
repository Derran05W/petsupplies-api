import { describe, it, expect, vi, beforeEach } from 'vitest';
import { siteSettingsPatchSchema } from '../../src/schemas/siteSettings.js';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/revalidationService.js', () => ({
  revalidateFrontendTags: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma.js';
import * as siteSettingsService from '../../src/services/siteSettingsService.js';

const baseRow = {
  id: 'singleton',
  freeShippingThresholdCents: 5000,
  flatShippingCents: 599,
  brandName: "Aileen's petstore",
  supportEmail: 'hello@aileenspetstore.com',
  tagline: "Food they'll actually love.",
  description: 'Thoughtfully sourced, vet-approved nutrition for every pet.',
  logoAccentWords: 1,
  socialInstagram: null,
  socialFacebook: null,
  socialTwitter: null,
  heroEyebrow: 'New season · vet approved',
  heroHeadline: "Food they'll actually love.",
  heroSubhead: 'Thoughtfully sourced, vet-approved nutrition for every pet.',
  heroImageUrl: '/images/hero-placeholder.jpg',
  heroPrimaryCtaLabel: 'Shop now',
  heroPrimaryCtaHref: '/products',
  heroSecondaryCtaLabel: 'Browse categories',
  heroSecondaryCtaHref: '#categories',
  brandValuesJson: [{ title: 'Free shipping', body: 'On every order over $50.' }],
  rewardTiersJson: [{ thresholdCents: 5000, label: 'Silver' }],
  updatedAt: new Date(),
  updatedBy: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  siteSettingsService.resetSiteSettingsCacheForTests();
});

describe('siteSettingsPatchSchema', () => {
  it('rejects negative freeShippingThresholdCents', () => {
    const r = siteSettingsPatchSchema.safeParse({ freeShippingThresholdCents: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects more than 3 brand values', () => {
    const r = siteSettingsPatchSchema.safeParse({
      brandValues: [
        { title: 'a', body: 'b' },
        { title: 'c', body: 'd' },
        { title: 'e', body: 'f' },
        { title: 'g', body: 'h' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('accepts partial patch with valid brand values', () => {
    const r = siteSettingsPatchSchema.safeParse({
      brandValues: [{ title: 'Vet approved', body: 'Trusted recipes.' }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts valid reward tiers', () => {
    const r = siteSettingsPatchSchema.safeParse({
      rewardTiers: [
        { thresholdCents: 2500, label: 'Bronze' },
        { thresholdCents: 5000, label: 'Silver' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects reward tiers with duplicate thresholds', () => {
    const r = siteSettingsPatchSchema.safeParse({
      rewardTiers: [
        { thresholdCents: 5000, label: 'Silver' },
        { thresholdCents: 5000, label: 'Dup' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects more than 10 reward tiers', () => {
    const r = siteSettingsPatchSchema.safeParse({
      rewardTiers: Array.from({ length: 11 }, (_, i) => ({
        thresholdCents: i * 1000,
        label: `Tier ${i}`,
      })),
    });
    expect(r.success).toBe(false);
  });

  it('rejects negative reward tier thresholds', () => {
    const r = siteSettingsPatchSchema.safeParse({
      rewardTiers: [{ thresholdCents: -1, label: 'Bad' }],
    });
    expect(r.success).toBe(false);
  });

  describe('hero URL scheme validation (B4)', () => {
    it('rejects a javascript: heroImageUrl', () => {
      const r = siteSettingsPatchSchema.safeParse({ heroImageUrl: 'javascript:alert(1)' });
      expect(r.success).toBe(false);
    });

    it('rejects a javascript: heroPrimaryCtaHref', () => {
      const r = siteSettingsPatchSchema.safeParse({
        heroPrimaryCtaHref: 'javascript:alert(1)',
      });
      expect(r.success).toBe(false);
    });

    it('rejects a data: heroSecondaryCtaHref', () => {
      const r = siteSettingsPatchSchema.safeParse({
        heroSecondaryCtaHref: 'data:text/html,<script>alert(1)</script>',
      });
      expect(r.success).toBe(false);
    });

    it('accepts an absolute https URL for heroImageUrl', () => {
      const r = siteSettingsPatchSchema.safeParse({
        heroImageUrl: 'https://cdn.example.com/x.png',
      });
      expect(r.success).toBe(true);
    });

    it('accepts an empty string for heroImageUrl (clears to default)', () => {
      const r = siteSettingsPatchSchema.safeParse({ heroImageUrl: '' });
      expect(r.success).toBe(true);
    });

    it('accepts the seeded site-relative defaults (heroImageUrl, heroPrimaryCtaHref)', () => {
      const r = siteSettingsPatchSchema.safeParse({
        heroImageUrl: '/images/hero-placeholder.jpg',
        heroPrimaryCtaHref: '/products',
      });
      expect(r.success).toBe(true);
    });

    it('accepts the seeded hash-anchor default for heroSecondaryCtaHref', () => {
      const r = siteSettingsPatchSchema.safeParse({ heroSecondaryCtaHref: '#categories' });
      expect(r.success).toBe(true);
    });

    it('rejects a protocol-relative //host URL', () => {
      const r = siteSettingsPatchSchema.safeParse({ heroImageUrl: '//evil.example.com/x.png' });
      expect(r.success).toBe(false);
    });
  });
});

describe('siteSettingsService', () => {
  it('toPublicDto omits updatedBy and parses brandValues', () => {
    const dto = siteSettingsService.toPublicDto(baseRow as never);
    expect(dto).not.toHaveProperty('updatedBy');
    expect(dto.brandName).toBe("Aileen's petstore");
    expect(dto.brandValues).toHaveLength(1);
    expect(dto.brandValues[0]?.title).toBe('Free shipping');
  });

  it('getSiteSettings reads from DB and caches', async () => {
    vi.mocked(prisma.siteSettings.findUnique).mockResolvedValue(baseRow as never);

    const a = await siteSettingsService.getSiteSettings();
    const b = await siteSettingsService.getSiteSettings();

    expect(a.freeShippingThresholdCents).toBe(5000);
    expect(prisma.siteSettings.findUnique).toHaveBeenCalledTimes(1);
    expect(b.id).toBe('singleton');
  });

  it('updateSiteSettings merges patch and returns public DTO', async () => {
    const updated = { ...baseRow, freeShippingThresholdCents: 7500, updatedBy: 'admin-1' };
    vi.mocked(prisma.siteSettings.upsert).mockResolvedValue(updated as never);

    const dto = await siteSettingsService.updateSiteSettings(
      { freeShippingThresholdCents: 7500 },
      'admin-1',
    );

    expect(dto.freeShippingThresholdCents).toBe(7500);
    expect(dto).not.toHaveProperty('updatedBy');
    expect(prisma.siteSettings.upsert).toHaveBeenCalled();
  });

  it('toPublicDto parses rewardTiers and drops invalid entries', () => {
    const row = {
      ...baseRow,
      rewardTiersJson: [
        { thresholdCents: 5000, label: 'Silver' },
        { thresholdCents: 'nope', label: 'Bad' }, // invalid threshold
        { label: 'Missing threshold' }, // missing field
        { thresholdCents: 10000, label: 'Gold' },
      ],
    };
    const dto = siteSettingsService.toPublicDto(row as never);
    expect(dto.rewardTiers).toEqual([
      { thresholdCents: 5000, label: 'Silver' },
      { thresholdCents: 10000, label: 'Gold' },
    ]);
  });

  it('toPublicDto returns [] when rewardTiersJson is not an array', () => {
    const dto = siteSettingsService.toPublicDto({ ...baseRow, rewardTiersJson: null } as never);
    expect(dto.rewardTiers).toEqual([]);
  });

  it('updateSiteSettings sorts reward tiers ascending by threshold before persisting', async () => {
    vi.mocked(prisma.siteSettings.upsert).mockResolvedValue(baseRow as never);

    await siteSettingsService.updateSiteSettings(
      {
        rewardTiers: [
          { thresholdCents: 10000, label: 'Gold' },
          { thresholdCents: 2500, label: 'Bronze' },
          { thresholdCents: 5000, label: 'Silver' },
        ],
      },
      'admin-1',
    );

    const call = vi.mocked(prisma.siteSettings.upsert).mock.calls[0][0] as unknown as {
      update: { rewardTiersJson: Array<{ thresholdCents: number; label: string }> };
    };
    expect(call.update.rewardTiersJson).toEqual([
      { thresholdCents: 2500, label: 'Bronze' },
      { thresholdCents: 5000, label: 'Silver' },
      { thresholdCents: 10000, label: 'Gold' },
    ]);
  });
});
