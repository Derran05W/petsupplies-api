import { z } from 'zod';
import { EMAIL_TEMPLATE_KEYS } from '../constants/emailTemplateDefaults.js';

export const emailTemplateKeySchema = z.enum(EMAIL_TEMPLATE_KEYS);

export const emailTemplateUpsertSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    preheader: z.string().trim().max(200).nullable().optional(),
    bodyMarkdown: z.string().max(50_000),
  })
  .strict();

export type EmailTemplateUpsertInput = z.infer<typeof emailTemplateUpsertSchema>;
