import { env } from '../types/env.js';

export type CanadaPostErrorCode = 'CP_TIMEOUT' | 'CP_AUTH' | 'CP_BAD_RESPONSE' | 'CP_UNAVAILABLE';

export class CanadaPostClientError extends Error {
  readonly code: CanadaPostErrorCode;

  constructor(code: CanadaPostErrorCode, message: string) {
    super(message);
    this.name = 'CanadaPostClientError';
    this.code = code;
  }
}

export type CanadaPostParcelInput = {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  originPostalCode: string;
  destinationPostalCode: string;
};

export type NormalizedCanadaPostRate = {
  serviceCode: string;
  serviceName: string;
  amountCents: number;
  estimatedDeliveryDays?: number;
};

const RATE_NS = 'http://www.canadapost-postescanada.ca/schema/v4/rate';

/** Parse CPC Rate v4 XML price-quotes (minimal extraction; tests use mocked responses). */
export function parseCanadaPostRatesXml(xml: string): NormalizedCanadaPostRate[] {
  const rates: NormalizedCanadaPostRate[] = [];
  const quoteRegex = /<price-quote[^>]*>([\s\S]*?)<\/price-quote>/gi;
  let m: RegExpExecArray | null;
  while ((m = quoteRegex.exec(xml)) !== null) {
    const block = m[1];
    const codeMatch = /<service-code>([^<]+)<\/service-code>/i.exec(block);
    const nameMatch = /<service-name>([^<]*)<\/service-name>/i.exec(block);
    const dueMatch = /<due[^>]*amount="([^"]+)"/i.exec(block);
    const transitMatch = /<expected-transit-time>(\d+)<\/expected-transit-time>/i.exec(block);
    if (!codeMatch || !dueMatch) continue;
    const dollars = parseFloat(dueMatch[1]);
    if (Number.isNaN(dollars)) continue;
    const amountCents = Math.round(dollars * 100);
    let estimatedDeliveryDays: number | undefined;
    if (transitMatch) {
      estimatedDeliveryDays = parseInt(transitMatch[1], 10);
    }
    rates.push({
      serviceCode: codeMatch[1].trim(),
      serviceName: (nameMatch?.[1] ?? codeMatch[1]).trim(),
      amountCents,
      estimatedDeliveryDays,
    });
  }
  if (rates.length === 0 && xml.includes('service-code')) {
    throw new CanadaPostClientError('CP_BAD_RESPONSE', 'Unrecognized Canada Post rate XML');
  }
  return rates;
}

function buildMailingScenarioXml(parcel: CanadaPostParcelInput): string {
  const weightKg = (parcel.weightGrams / 1000).toFixed(3);
  const customer = env.CANADA_POST_CUSTOMER_NUMBER!.trim();
  const contract = env.CANADA_POST_CONTRACT_ID?.trim();
  const contractXml = contract ? `\n  <contract-id>${escapeXml(contract)}</contract-id>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<mailing-scenario xmlns="${RATE_NS}">
  <customer-number>${escapeXml(customer)}</customer-number>${contractXml}
  <quote-type>commercial</quote-type>
  <parcel-characteristics>
    <weight>${weightKg}</weight>
    <dimensions>
      <length>${parcel.lengthCm}</length>
      <width>${parcel.widthCm}</width>
      <height>${parcel.heightCm}</height>
    </dimensions>
  </parcel-characteristics>
  <origin-postal-code>${escapeXml(parcel.originPostalCode)}</origin-postal-code>
  <destination>
    <domestic>
      <postal-code>${escapeXml(parcel.destinationPostalCode)}</postal-code>
    </domestic>
  </destination>
</mailing-scenario>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function canadaPostBaseUrl(): string {
  return env.CANADA_POST_USE_TEST
    ? 'https://ct.soa-gw.canadapost.ca'
    : 'https://soa-gw.canadapost.ca';
}

function basicAuthHeader(): string {
  const user = (env.CANADA_POST_USERNAME ?? env.CANADA_POST_CUSTOMER_NUMBER)?.trim();
  const pass = env.CANADA_POST_API_KEY?.trim();
  if (!user || !pass) {
    throw new CanadaPostClientError('CP_UNAVAILABLE', 'Canada Post credentials missing');
  }
  const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

const MAX_WEIGHT_G = 30_000;
const MAX_DIM_CM = 200;

export function isParcelOversized(parcel: CanadaPostParcelInput): boolean {
  if (parcel.weightGrams > MAX_WEIGHT_G) return true;
  if (parcel.lengthCm > MAX_DIM_CM || parcel.widthCm > MAX_DIM_CM || parcel.heightCm > MAX_DIM_CM) {
    return true;
  }
  return false;
}

export type FetchLike = typeof fetch;

/**
 * Request live rates from Canada Post Ship Rate v4. Returns normalized options (unsorted).
 * Caller should catch {@link CanadaPostClientError} and fall back.
 */
export async function requestCanadaPostRates(
  parcel: CanadaPostParcelInput,
  options?: { fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<NormalizedCanadaPostRate[]> {
  if (
    !env.CANADA_POST_API_KEY?.trim() ||
    !env.CANADA_POST_CUSTOMER_NUMBER?.trim() ||
    !env.SHIP_FROM_POSTAL_CODE
  ) {
    throw new CanadaPostClientError('CP_UNAVAILABLE', 'Canada Post not configured');
  }

  if (isParcelOversized(parcel)) {
    throw new CanadaPostClientError('CP_UNAVAILABLE', 'Parcel over Canada Post limits');
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? env.SHIPPING_QUOTE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = `${canadaPostBaseUrl()}/rs/ship/price`;
  const body = buildMailingScenarioXml(parcel);

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/vnd.cpc.ship.rate-v4+xml',
        Accept: 'application/vnd.cpc.ship.rate-v4+xml',
      },
      body,
      signal: controller.signal,
    });

    const text = await res.text();

    if (res.status === 401 || res.status === 403) {
      throw new CanadaPostClientError('CP_AUTH', `Canada Post auth failed (${res.status})`);
    }

    if (!res.ok) {
      throw new CanadaPostClientError('CP_UNAVAILABLE', `Canada Post HTTP ${res.status}`);
    }

    return parseCanadaPostRatesXml(text);
  } catch (e) {
    if (e instanceof CanadaPostClientError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new CanadaPostClientError('CP_TIMEOUT', 'Canada Post request timed out');
    }
    throw new CanadaPostClientError(
      'CP_BAD_RESPONSE',
      e instanceof Error ? e.message : 'fetch failed',
    );
  } finally {
    clearTimeout(timer);
  }
}
