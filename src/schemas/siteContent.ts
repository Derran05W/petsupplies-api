import { z } from 'zod';

export const navHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (href) =>
      href.startsWith('/') ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      /^https?:\/\//i.test(href),
    { message: 'href must be a relative path, hash link, mailto URL, or absolute http(s) URL' },
  );

export const navLinkInputSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    href: navHrefSchema,
    position: z.number().int().nonnegative(),
  })
  .strict();

export const replaceHeaderNavSchema = z.array(navLinkInputSchema).max(20);

export const footerColumnInputSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'Column key must be lowercase alphanumeric with hyphens'),
    label: z.string().trim().min(1).max(120),
    position: z.number().int().nonnegative(),
  })
  .strict();

export const footerLinkInputSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    href: navHrefSchema,
    position: z.number().int().nonnegative(),
  })
  .strict();

export const footerColumnWithLinksSchema = z
  .object({
    column: footerColumnInputSchema,
    links: z.array(footerLinkInputSchema).max(20),
  })
  .strict();

export const replaceFooterNavSchema = z.array(footerColumnWithLinksSchema).min(1).max(4);

export const replaceFeaturedProductsSchema = z
  .object({
    productIds: z.array(z.string().min(1)).max(8),
  })
  .strict();

export const categoryStripItemInputSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    imageUrl: z.string().max(2048).nullable().optional(),
    href: navHrefSchema,
    position: z.number().int().nonnegative(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const replaceCategoryStripSchema = z.array(categoryStripItemInputSchema).max(12);

export type ReplaceHeaderNavInput = z.infer<typeof replaceHeaderNavSchema>;
export type ReplaceFooterNavInput = z.infer<typeof replaceFooterNavSchema>;
export type ReplaceFeaturedProductsInput = z.infer<typeof replaceFeaturedProductsSchema>;
export type ReplaceCategoryStripInput = z.infer<typeof replaceCategoryStripSchema>;

export function assertUniquePositions(items: Array<{ position: number }>, context: string): void {
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.position)) {
      throw new Error(`Duplicate position in ${context}`);
    }
    seen.add(item.position);
  }
}
