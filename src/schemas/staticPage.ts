import { z } from 'zod';
import { STATIC_PAGE_SLUGS } from '../constants/staticPageDefaults.js';

export const staticPageSlugSchema = z.enum(STATIC_PAGE_SLUGS);

export const staticPageUpsertSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    bodyMarkdown: z.string().max(100_000),
    isPublished: z.boolean(),
  })
  .strict();

export type StaticPageUpsertInput = z.infer<typeof staticPageUpsertSchema>;
