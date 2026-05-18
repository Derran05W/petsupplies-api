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
    CANADA_POST_API_KEY: z.string().optional(),
    CANADA_POST_CUSTOMER_NUMBER: z.string().optional(),
    CANADA_POST_USERNAME: z.string().optional(),
    CANADA_POST_CONTRACT_ID: z.string().optional(),
    CANADA_POST_USE_TEST: z
      .any()
      .optional()
      .transform((v) => {
        if (v === undefined || v === '') return true;
        if (typeof v === 'boolean') return v;
        const s = String(v).toLowerCase();
        return s !== 'false' && s !== '0';
      }),
    SHIP_FROM_POSTAL_CODE: z
      .string()
      .optional()
      .superRefine((val, ctx) => {
        if (val === undefined || val.trim() === '') return;
        const c = val.replace(/\s/g, '').toUpperCase();
        if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(c)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'SHIP_FROM_POSTAL_CODE must be a valid Canadian postal code',
            path: [],
          });
        }
      })
      .transform((s) => {
        if (s === undefined || s.trim() === '') return undefined;
        return s.replace(/\s/g, '').toUpperCase();
      }),
    SHIPPING_QUOTE_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
    DEFAULT_PACKAGE_WEIGHT_GRAMS: z.coerce.number().int().positive().default(500),
    DEFAULT_PACKAGE_L_CM: z.coerce.number().int().positive().default(25),
    DEFAULT_PACKAGE_W_CM: z.coerce.number().int().positive().default(20),
    DEFAULT_PACKAGE_H_CM: z.coerce.number().int().positive().default(10),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    CRON_BEARER_TOKEN: z.string().min(32),
    SUPABASE_STORAGE_BUCKET: z.string().min(1).default('product-images'),
    SUPABASE_PRODUCT_IMAGE_MAX_BYTES: z.coerce.number().int().positive().default(5_000_000),
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
      if (!data.CRON_BEARER_TOKEN.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CRON_BEARER_TOKEN cannot be empty in production',
          path: ['CRON_BEARER_TOKEN'],
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
