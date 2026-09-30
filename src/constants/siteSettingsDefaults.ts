import type { Prisma } from '@prisma/client';

/** Brand + hero defaults aligned with petsupplies-web at planning time. */
export const SITE_SETTINGS_BRAND_DEFAULTS = {
  brandName: "Aileen's petstore",
  logoAccentWords: 1,
  tagline: "Food they'll actually love.",
  description: 'Thoughtfully sourced, vet-approved nutrition for every pet.',
  supportEmail: 'hello@aileenspetstore.com',
  socialInstagram: null as string | null,
  socialFacebook: null as string | null,
  socialTwitter: null as string | null,
} as const;

export const SITE_SETTINGS_HERO_DEFAULTS = {
  heroEyebrow: 'New season · vet approved',
  heroHeadline: SITE_SETTINGS_BRAND_DEFAULTS.tagline,
  heroSubhead: SITE_SETTINGS_BRAND_DEFAULTS.description,
  heroImageUrl: '/images/hero-placeholder.jpg',
  heroPrimaryCtaLabel: 'Shop now',
  heroPrimaryCtaHref: '/products',
  heroSecondaryCtaLabel: 'Browse categories',
  heroSecondaryCtaHref: '#categories',
} as const;

export const SITE_SETTINGS_BRAND_VALUES_DEFAULT: Prisma.InputJsonValue = [
  {
    title: 'Free shipping',
    body: 'On every order over $50, anywhere in the country.',
    icon: 'truck',
  },
  {
    title: 'Vet approved',
    body: 'Recipes formulated alongside practising veterinarians.',
    icon: 'stethoscope',
  },
];

export const SITE_SETTINGS_REWARD_TIERS_DEFAULT: Prisma.InputJsonValue = [];

export function buildSiteSettingsSeedData(env: {
  freeShippingThresholdCents: number;
  flatShippingCents: number;
}): Prisma.SiteSettingsCreateInput {
  return {
    id: 'singleton',
    freeShippingThresholdCents: env.freeShippingThresholdCents,
    flatShippingCents: env.flatShippingCents,
    ...SITE_SETTINGS_BRAND_DEFAULTS,
    ...SITE_SETTINGS_HERO_DEFAULTS,
    brandValuesJson: SITE_SETTINGS_BRAND_VALUES_DEFAULT,
    rewardTiersJson: SITE_SETTINGS_REWARD_TIERS_DEFAULT,
  };
}
