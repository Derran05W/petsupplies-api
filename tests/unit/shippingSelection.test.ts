import { describe, it, expect } from 'vitest';
import { encodeSelectionToken, verifySelectionToken } from '../../src/lib/shippingSelection.js';
import type { ShippingSelectionPayload } from '../../src/types/shipping.js';

const secret = 'whsec_test_selection_secret_key_123456';

function basePayload(overrides: Partial<ShippingSelectionPayload> = {}): ShippingSelectionPayload {
  return {
    expiresAtMs: Date.now() + 60_000,
    userId: 'u1',
    cartFingerprint: 'abc123',
    destPostalCode: 'K1A0B1',
    serviceCode: 'DOM.EP',
    serviceName: 'Expedited Parcel',
    amountCents: 999,
    carrier: 'CANADA_POST',
    shipQuoteSource: 'canada_post',
    ...overrides,
  };
}

describe('shippingSelection token', () => {
  it('round-trips verify', () => {
    const payload = basePayload();
    const token = encodeSelectionToken(secret, payload);
    const v = verifySelectionToken(secret, token);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.amountCents).toBe(999);
      expect(v.payload.serviceCode).toBe('DOM.EP');
    }
  });

  it('fails with wrong secret', () => {
    const token = encodeSelectionToken(secret, basePayload());
    const v = verifySelectionToken('other_secret_32_chars_minimum_len!', token);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('BAD_SIGNATURE');
  });

  it('fails when expired', () => {
    const payload = basePayload({ expiresAtMs: Date.now() - 1000 });
    const token = encodeSelectionToken(secret, payload);
    const v = verifySelectionToken(secret, token);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('EXPIRED');
  });

  it('fails on garbage token', () => {
    const v = verifySelectionToken(secret, 'not-a-token');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('INVALID_TOKEN');
  });
});
