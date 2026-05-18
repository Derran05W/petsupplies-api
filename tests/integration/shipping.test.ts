import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { createApp } from '../../src/app.js';

vi.mock('../../src/services/shippingService.js', () => ({
  quoteForCart: vi.fn(),
}));

import * as shippingService from '../../src/services/shippingService.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

async function authToken(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /shipping/quote', () => {
  it('returns 401 without auth', async () => {
    const app = createApp();
    const res = await app.request('/shipping/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line1: '1',
        city: 'O',
        region: 'ON',
        postalCode: 'K1A 0A1',
        country: 'CA',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid postal code', async () => {
    const app = createApp();
    const t = await authToken('u1');
    const res = await app.request('/shipping/quote', {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line1: '1',
        city: 'O',
        region: 'ON',
        postalCode: '00000',
        country: 'CA',
      }),
    });
    expect(res.status).toBe(400);
    expect(shippingService.quoteForCart).not.toHaveBeenCalled();
  });

  it('calls quoteForCart on valid body', async () => {
    vi.mocked(shippingService.quoteForCart).mockResolvedValue({
      source: 'fallback',
      options: [
        {
          serviceCode: 'FALLBACK.FLAT',
          serviceName: 'Standard shipping',
          carrier: 'FLAT',
          amountCents: 599,
          selectionToken: 'tok',
        },
      ],
      expiresAt: new Date().toISOString(),
    });
    const app = createApp();
    const t = await authToken('u1');
    const res = await app.request('/shipping/quote', {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line1: '1 Main',
        city: 'Ottawa',
        region: 'ON',
        postalCode: 'K1A 0A1',
        country: 'CA',
      }),
    });
    expect(res.status).toBe(200);
    expect(shippingService.quoteForCart).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ country: 'CA' }),
    );
  });
});
