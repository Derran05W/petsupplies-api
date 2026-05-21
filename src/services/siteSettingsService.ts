import type { Prisma, SiteSettings } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import {
  buildSiteSettingsSeedData,
  SITE_SETTINGS_BRAND_DEFAULTS,
  SITE_SETTINGS_HERO_DEFAULTS,
} from '../constants/siteSettingsDefaults.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../types/env.js';
import type { SiteSettingsPatch } from '../schemas/siteSettings.js';
import { brandValueSchema } from '../schemas/siteSettings.js';
import { revalidateFrontendTags } from './revalidationService.js';

const CACHE_TTL_MS = 30_000;
const SINGLETON_ID = 'singleton';

let cache: { row: SiteSettings; expiresAt: number } | null = null;

export type BrandValue = {
  title: string;
  body: string;
  icon?: string;
};

export type SiteSettingsPublic = {
  freeShippingThresholdCents: number;
  flatShippingCents: number;
  brandName: string;
  supportEmail: string;
  tagline: string;
  description: string;
  logoAccentWords: number;
  socialInstagram: string | null;
  socialFacebook: string | null;
  socialTwitter: string | null;
  heroEyebrow: string;
  heroHeadline: string;
  heroSubhead: string;
  heroImageUrl: string;
  heroPrimaryCtaLabel: string;
  heroPrimaryCtaHref: string;
  heroSecondaryCtaLabel: string;
  heroSecondaryCtaHref: string;
  brandValues: BrandValue[];
};

export type EmailBrandContext = {
  brandName: string;
  supportEmail: string;
  frontendUrl: string;
};

function parseBrandValues(json: Prisma.JsonValue): BrandValue[] {
  if (!Array.isArray(json)) return [];
  const out: BrandValue[] = [];
  for (const item of json) {
    const parsed = brandValueSchema.safeParse(item);
    if (parsed.success) {
      out.push(parsed.data);
    }
  }
  return out;
}

function fallbackRow(): SiteSettings {
  const now = new Date();
  return {
    id: SINGLETON_ID,
    freeShippingThresholdCents: env.FREE_SHIPPING_THRESHOLD_CENTS,
    flatShippingCents: env.FLAT_SHIPPING_CENTS,
    brandName: SITE_SETTINGS_BRAND_DEFAULTS.brandName,
    supportEmail: SITE_SETTINGS_BRAND_DEFAULTS.supportEmail,
    tagline: SITE_SETTINGS_BRAND_DEFAULTS.tagline,
    description: SITE_SETTINGS_BRAND_DEFAULTS.description,
    logoAccentWords: SITE_SETTINGS_BRAND_DEFAULTS.logoAccentWords,
    socialInstagram: SITE_SETTINGS_BRAND_DEFAULTS.socialInstagram,
    socialFacebook: SITE_SETTINGS_BRAND_DEFAULTS.socialFacebook,
    socialTwitter: SITE_SETTINGS_BRAND_DEFAULTS.socialTwitter,
    heroEyebrow: SITE_SETTINGS_HERO_DEFAULTS.heroEyebrow,
    heroHeadline: SITE_SETTINGS_HERO_DEFAULTS.heroHeadline,
    heroSubhead: SITE_SETTINGS_HERO_DEFAULTS.heroSubhead,
    heroImageUrl: SITE_SETTINGS_HERO_DEFAULTS.heroImageUrl,
    heroPrimaryCtaLabel: SITE_SETTINGS_HERO_DEFAULTS.heroPrimaryCtaLabel,
    heroPrimaryCtaHref: SITE_SETTINGS_HERO_DEFAULTS.heroPrimaryCtaHref,
    heroSecondaryCtaLabel: SITE_SETTINGS_HERO_DEFAULTS.heroSecondaryCtaLabel,
    heroSecondaryCtaHref: SITE_SETTINGS_HERO_DEFAULTS.heroSecondaryCtaHref,
    brandValuesJson: [],
    updatedAt: now,
    updatedBy: null,
  };
}

export function invalidateSiteSettingsCache(): void {
  cache = null;
}

/** Test helper — clears module-level cache between Vitest cases. */
export function resetSiteSettingsCacheForTests(): void {
  invalidateSiteSettingsCache();
}

export function toPublicDto(row: SiteSettings): SiteSettingsPublic {
  return {
    freeShippingThresholdCents: row.freeShippingThresholdCents,
    flatShippingCents: row.flatShippingCents,
    brandName: row.brandName,
    supportEmail: row.supportEmail,
    tagline: row.tagline,
    description: row.description,
    logoAccentWords: row.logoAccentWords,
    socialInstagram: row.socialInstagram,
    socialFacebook: row.socialFacebook,
    socialTwitter: row.socialTwitter,
    heroEyebrow: row.heroEyebrow,
    heroHeadline: row.heroHeadline,
    heroSubhead: row.heroSubhead,
    heroImageUrl: row.heroImageUrl,
    heroPrimaryCtaLabel: row.heroPrimaryCtaLabel,
    heroPrimaryCtaHref: row.heroPrimaryCtaHref,
    heroSecondaryCtaLabel: row.heroSecondaryCtaLabel,
    heroSecondaryCtaHref: row.heroSecondaryCtaHref,
    brandValues: parseBrandValues(row.brandValuesJson),
  };
}

export async function getSiteSettings(): Promise<SiteSettings> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.row;
  }

  try {
    let row = await prisma.siteSettings.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) {
      row = await prisma.siteSettings.create({
        data: buildSiteSettingsSeedData({
          freeShippingThresholdCents: env.FREE_SHIPPING_THRESHOLD_CENTS,
          flatShippingCents: env.FLAT_SHIPPING_CENTS,
        }),
      });
    }
    cache = { row, expiresAt: Date.now() + CACHE_TTL_MS };
    return row;
  } catch (e) {
    console.warn('[siteSettings] DB read failed, using env fallback', {
      error: e instanceof Error ? e.message : 'unknown',
    });
    return fallbackRow();
  }
}

export async function getSiteSettingsPublic(): Promise<SiteSettingsPublic> {
  return toPublicDto(await getSiteSettings());
}

export async function getShippingCentsConfig(): Promise<{
  freeShippingThresholdCents: number;
  flatShippingCents: number;
}> {
  const row = await getSiteSettings();
  return {
    freeShippingThresholdCents: row.freeShippingThresholdCents,
    flatShippingCents: row.flatShippingCents,
  };
}

export async function getEmailBrandContext(): Promise<EmailBrandContext> {
  try {
    const row = await getSiteSettings();
    return {
      brandName: row.brandName.trim() || 'our store',
      supportEmail: row.supportEmail.trim(),
      frontendUrl: env.FRONTEND_URL,
    };
  } catch (e) {
    console.warn('[siteSettings] email brand fallback', {
      error: e instanceof Error ? e.message : 'unknown',
    });
    return {
      brandName: 'our store',
      supportEmail: env.EMAIL_FROM?.trim() ?? '',
      frontendUrl: env.FRONTEND_URL,
    };
  }
}

export async function updateSiteSettings(
  patch: SiteSettingsPatch,
  userId: string,
): Promise<SiteSettingsPublic> {
  invalidateSiteSettingsCache();

  const data: Prisma.SiteSettingsUpdateInput = {
    updatedBy: userId,
  };

  const scalarKeys = [
    'freeShippingThresholdCents',
    'flatShippingCents',
    'brandName',
    'supportEmail',
    'tagline',
    'description',
    'logoAccentWords',
    'socialInstagram',
    'socialFacebook',
    'socialTwitter',
    'heroEyebrow',
    'heroHeadline',
    'heroSubhead',
    'heroImageUrl',
    'heroPrimaryCtaLabel',
    'heroPrimaryCtaHref',
    'heroSecondaryCtaLabel',
    'heroSecondaryCtaHref',
  ] as const;

  for (const key of scalarKeys) {
    if (patch[key] !== undefined) {
      (data as Record<string, unknown>)[key] = patch[key];
    }
  }

  if (patch.brandValues !== undefined) {
    data.brandValuesJson = patch.brandValues;
  }

  try {
    const seed = buildSiteSettingsSeedData({
      freeShippingThresholdCents: env.FREE_SHIPPING_THRESHOLD_CENTS,
      flatShippingCents: env.FLAT_SHIPPING_CENTS,
    });
    const { brandValues, ...scalarPatch } = patch;
    const updated = await prisma.siteSettings.upsert({
      where: { id: SINGLETON_ID },
      create: {
        ...seed,
        ...scalarPatch,
        brandValuesJson: brandValues ?? seed.brandValuesJson,
        updatedBy: userId,
      },
      update: data,
    });

    cache = { row: updated, expiresAt: Date.now() + CACHE_TTL_MS };
    await revalidateFrontendTags(['site-settings']);
    return toPublicDto(updated);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Update failed';
    throw new HTTPException(400, { message });
  }
}
