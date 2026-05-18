import { z } from 'zod';

const cuid = z.string().regex(/^c[a-z0-9]{24}$/, 'Invalid id');

export const caPostalSchema = z
  .string()
  .regex(/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i)
  .transform((s) => s.replace(/\s/g, '').toUpperCase());

const sharedDestinationFields = z.object({
  addressId: cuid.optional(),
  line1: z.string().min(1).optional(),
  line2: z.string().optional(),
  city: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  postalCode: caPostalSchema.optional(),
  country: z.literal('CA').optional(),
});

function addDestinationRefinement<D extends z.ZodObject>(schema: D) {
  return schema.superRefine((data, ctx) => {
    const row = data as {
      addressId?: string;
      line1?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      country?: 'CA';
    };
    if (row.addressId) {
      const inline = !!(row.line1 || row.city || row.region || row.postalCode || row.country);
      if (inline) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Use addressId or inline address, not both',
          path: ['addressId'],
        });
      }
      return;
    }
    if (!row.line1 || !row.city || !row.region || !row.postalCode || row.country !== 'CA') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Full Canadian inline address required when addressId is omitted',
        path: ['postalCode'],
      });
    }
  });
}

export const shippingQuoteBodySchema = addDestinationRefinement(sharedDestinationFields);

export const checkoutShippingSelectionBodySchema = addDestinationRefinement(
  z
    .object({
      selectionToken: z.string().min(1),
      serviceCode: z.string().min(1),
      amountCents: z.number().int().nonnegative(),
    })
    .merge(sharedDestinationFields),
);

export const checkoutSessionBodySchema = z
  .object({
    shippingSelection: checkoutShippingSelectionBodySchema.optional(),
  })
  .strict();

export type ShippingQuoteBody = z.infer<typeof shippingQuoteBodySchema>;
export type CheckoutSessionBody = z.infer<typeof checkoutSessionBodySchema>;
export type CheckoutShippingSelection = z.infer<typeof checkoutShippingSelectionBodySchema>;
