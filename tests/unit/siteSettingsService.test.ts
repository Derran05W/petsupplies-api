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
});
