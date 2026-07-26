import { z } from 'zod';

export const brandValueSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  icon: z.string().max(64).optional(),
});

export const rewardTierSchema = z
  .object({
    thresholdCents: z.number().int().min(0),
    label: z.string().trim().min(1).max(120),
  })
  .strict();

/**
 * Hero image/link fields accept an absolute http(s) URL, a site-relative
 * path (e.g. "/products" or "/images/hero.jpg" — docs/site-assets.md
 * documents heroImageUrl accepting "a site-relative path", and the seeded
 * hero CTA defaults are relative paths / a hash anchor: "/products",
 * "/images/hero-placeholder.jpg", "#categories"), or empty (the UI uses ''
 * to clear back to the default). This blocks dangerous schemes
 * (javascript:, data:, vbscript:, ...) without breaking that existing,
 * documented relative-path/anchor support.
 */
function heroUrlSchema(fieldName: string, options: { allowAnchor: boolean }) {
  return z
    .string()
    .max(2048)
    .superRefine((value, ctx) => {
      if (value === '') return;
      if (value.startsWith('/') && !value.startsWith('//')) return;
      if (options.allowAnchor && value.startsWith('#')) return;
      try {
        const protocol = new URL(value).protocol;
        if (protocol === 'http:' || protocol === 'https:') return;
      } catch {
        // fall through to the issue below
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} must be an http(s) URL, a site-relative path, or empty`,
      });
    });
}

export const siteSettingsPatchSchema = z
  .object({
    freeShippingThresholdCents: z.number().int().positive(),
    flatShippingCents: z.number().int().nonnegative(),
    brandName: z.string().min(1).max(120),
    supportEmail: z.string().email().or(z.literal('')),
    tagline: z.string().max(200),
    description: z.string().max(500),
    logoAccentWords: z.number().int().min(0).max(10),
    socialInstagram: z.string().url().nullable(),
    socialFacebook: z.string().url().nullable(),
    socialTwitter: z.string().url().nullable(),
    heroEyebrow: z.string().max(120),
    heroHeadline: z.string().max(200),
    heroSubhead: z.string().max(500),
    heroImageUrl: heroUrlSchema('heroImageUrl', { allowAnchor: false }),
    heroPrimaryCtaLabel: z.string().max(80),
    heroPrimaryCtaHref: heroUrlSchema('heroPrimaryCtaHref', { allowAnchor: true }),
    heroSecondaryCtaLabel: z.string().max(80),
    heroSecondaryCtaHref: heroUrlSchema('heroSecondaryCtaHref', { allowAnchor: true }),
    brandValues: z.array(brandValueSchema).max(3),
    rewardTiers: z.array(rewardTierSchema).max(10),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  })
  .superRefine((data, ctx) => {
    if (data.rewardTiers !== undefined) {
      const seen = new Set<number>();
      data.rewardTiers.forEach((tier, index) => {
        if (seen.has(tier.thresholdCents)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Reward tier thresholds must be unique',
            path: ['rewardTiers', index, 'thresholdCents'],
          });
        }
        seen.add(tier.thresholdCents);
      });
    }
  });

export type SiteSettingsPatch = z.infer<typeof siteSettingsPatchSchema>;

export const siteAssetUploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
});
