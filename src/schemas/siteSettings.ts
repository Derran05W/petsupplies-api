import { z } from 'zod';

export const brandValueSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  icon: z.string().max(64).optional(),
});

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
    heroImageUrl: z.string().max(2048),
    heroPrimaryCtaLabel: z.string().max(80),
    heroPrimaryCtaHref: z.string().max(2048),
    heroSecondaryCtaLabel: z.string().max(80),
    heroSecondaryCtaHref: z.string().max(2048),
    brandValues: z.array(brandValueSchema).max(3),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

export type SiteSettingsPatch = z.infer<typeof siteSettingsPatchSchema>;

export const siteAssetUploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
});
