import { z } from 'zod';

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    SUPABASE_URL: z.string().url(),
    SUPABASE_JWT_SECRET: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3001),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    FRONTEND_URL: z.string().url(),
    FREE_SHIPPING_THRESHOLD_CENTS: z.coerce.number().int().positive().default(5000),
    FLAT_SHIPPING_CENTS: z.coerce.number().int().nonnegative().default(599),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (!data.RESEND_API_KEY?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'RESEND_API_KEY is required in production',
          path: ['RESEND_API_KEY'],
        });
      }
      if (!data.EMAIL_FROM?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'EMAIL_FROM is required in production',
          path: ['EMAIL_FROM'],
        });
      }
    }
    if (data.EMAIL_FROM !== undefined && data.EMAIL_FROM.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'EMAIL_FROM cannot be empty when set',
        path: ['EMAIL_FROM'],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n  ');
    throw new Error(`Invalid environment variables:\n  ${missing}`);
  }
  const data = result.data;
  if (data.NODE_ENV !== 'production' && !data.EMAIL_FROM?.trim()) {
    return { ...data, EMAIL_FROM: 'Pet Supplies <dev@localhost>' };
  }
  return data;
}

export const env = validateEnv(process.env);
