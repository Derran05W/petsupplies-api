import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CanadaPostClientError,
  isParcelOversized,
  parseCanadaPostRatesXml,
  requestCanadaPostRates,
} from '../../src/services/canadaPostClient.js';

describe('parseCanadaPostRatesXml', () => {
  it('extracts service code, name, due amount, transit days', () => {
    const xml = `<?xml version="1.0"?>
    <price-quotes>
      <price-quote>
        <service-code>DOM.EP</service-code>
        <service-name>Expedited Parcel</service-name>
        <service-standard>
          <expected-transit-time>3</expected-transit-time>
        </service-standard>
        <price-details>
          <due amount="12.34"/>
        </price-details>
      </price-quote>
    </price-quotes>`;
    const rows = parseCanadaPostRatesXml(xml);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serviceCode: 'DOM.EP',
      serviceName: 'Expedited Parcel',
      amountCents: 1234,
      estimatedDeliveryDays: 3,
    });
  });

  it('throws CP_BAD_RESPONSE when XML hints at quotes but parse finds none', () => {
    expect(() =>
      parseCanadaPostRatesXml(
        '<price-quotes><price-quote><service-code>X</service-code></price-quote>',
      ),
    ).toThrow(CanadaPostClientError);
  });
});

describe('isParcelOversized', () => {
  const base = {
    weightGrams: 1000,
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    originPostalCode: 'K1A0A1',
    destinationPostalCode: 'H2Y1C6',
  };
  it('returns false for normal parcel', () => {
    expect(isParcelOversized(base)).toBe(false);
  });
  it('returns true when weight exceeds limit', () => {
    expect(isParcelOversized({ ...base, weightGrams: 50_000 })).toBe(true);
  });
  it('returns true when dimension exceeds limit', () => {
    expect(isParcelOversized({ ...base, lengthCm: 250 })).toBe(true);
  });
});

describe('requestCanadaPostRates', () => {
  const parcel = {
    weightGrams: 1500,
    lengthCm: 20,
    widthCm: 15,
    heightCm: 10,
    originPostalCode: 'K1A0A1',
    destinationPostalCode: 'H2Y1C6',
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          `<price-quotes><price-quote><service-code>DOM.EP</service-code><service-name>X</service-name><price-details><due amount="5.00"/></price-details></price-quote></price-quotes>`,
      }),
    );
  });

  it('returns normalized rows on HTTP 200', async () => {
    const rates = await requestCanadaPostRates(parcel, { fetchImpl: fetch });
    expect(rates).toHaveLength(1);
    expect(rates[0]?.amountCents).toBe(500);
  });

  it('throws CP_AUTH on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'no' }),
    );
    await expect(requestCanadaPostRates(parcel)).rejects.toMatchObject({ code: 'CP_AUTH' });
  });

  it('throws CP_UNAVAILABLE on HTTP 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' }),
    );
    await expect(requestCanadaPostRates(parcel)).rejects.toMatchObject({
      code: 'CP_UNAVAILABLE',
    });
  });

  it('throws CP_TIMEOUT on AbortError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      }),
    );
    await expect(requestCanadaPostRates(parcel)).rejects.toMatchObject({ code: 'CP_TIMEOUT' });
  });
});
