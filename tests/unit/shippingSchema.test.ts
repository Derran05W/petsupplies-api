import { describe, it, expect } from 'vitest';
import { shippingQuoteBodySchema } from '../../src/schemas/shipping.js';

describe('shippingQuoteBodySchema', () => {
  it('accepts addressId alone', () => {
    const r = shippingQuoteBodySchema.safeParse({
      addressId: 'c123456789012345678901234',
    });
    expect(r.success).toBe(true);
  });

  it('rejects mixing addressId with inline fields', () => {
    const r = shippingQuoteBodySchema.safeParse({
      addressId: 'c123456789012345678901234',
      line1: '1',
    });
    expect(r.success).toBe(false);
  });

  it('requires full inline address without addressId', () => {
    const r = shippingQuoteBodySchema.safeParse({
      line1: '1',
      city: 'O',
      region: 'ON',
      postalCode: 'K1A 0A1',
      country: 'CA',
    });
    expect(r.success).toBe(true);
  });

  it('rejects incomplete inline address', () => {
    const r = shippingQuoteBodySchema.safeParse({
      line1: '1',
      country: 'CA',
    });
    expect(r.success).toBe(false);
  });
});
