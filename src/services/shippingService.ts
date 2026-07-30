import { createHash } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';
import { encodeSelectionToken } from '../lib/shippingSelection.js';
import { env } from '../types/env.js';
import type {
  ShippingQuoteResponse,
  ShippingQuoteSource,
  ShippingRateOption,
} from '../types/shipping.js';
import * as discountService from './discountService.js';
import { getShippingCentsConfig } from './siteSettingsService.js';
import {
  CanadaPostClientError,
  isParcelOversized,
  requestCanadaPostRates,
  type CanadaPostParcelInput,
  type NormalizedCanadaPostRate,
} from './canadaPostClient.js';

const QUOTE_TTL_MS = 15 * 60 * 1000;
const MAX_QUOTE_OPTIONS = 4;

export type QuoteDestinationInput = {
  addressId?: string;
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

const productSelectQuote = {
  id: true,
  name: true,
  slug: true,
  price: true,
  imageUrl: true,
  stock: true,
  active: true,
  weightGrams: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  shipsSeparately: true,
} as const;

export function cartFingerprintFromItems(items: { productId: string; quantity: number }[]): string {
  const sorted = [...items].sort((a, b) => a.productId.localeCompare(b.productId));
  const payload = sorted.map((i) => `${i.productId}:${i.quantity}`).join('|');
  return createHash('sha256').update(payload).digest('hex');
}

function normalizeCanadianPostal(raw: string): string {
  return raw.replace(/\s/g, '').toUpperCase();
}

async function resolveDestinationPostal(
  userId: string,
  dest: QuoteDestinationInput,
): Promise<string> {
  if (dest.addressId) {
    const addr = await prisma.address.findFirst({
      where: { id: dest.addressId, userId },
    });
    if (!addr) {
      throw new HTTPException(404, { message: 'ADDRESS_NOT_FOUND' });
    }
    if (addr.country !== 'CA') {
      throw new HTTPException(422, { message: 'ADDRESS_COUNTRY_NOT_SUPPORTED' });
    }
    return normalizeCanadianPostal(addr.postalCode);
  }
  if (!dest.postalCode?.trim() || !dest.country) {
    throw new HTTPException(400, { message: 'ADDRESS_REQUIRED' });
  }
  if (dest.country !== 'CA') {
    throw new HTTPException(422, { message: 'ADDRESS_COUNTRY_NOT_SUPPORTED' });
  }
  return normalizeCanadianPostal(dest.postalCode);
}

export { resolveDestinationPostal };

type CartLine = {
  productId: string;
  quantity: number;
  product: {
    id: string;
    price: number;
    weightGrams: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
    shipsSeparately: boolean;
  };
};

function lineParcel(line: CartLine): CanadaPostParcelInput {
  const unitG = line.product.weightGrams ?? env.DEFAULT_PACKAGE_WEIGHT_GRAMS;
  const weightGrams = unitG * line.quantity;
  return {
    weightGrams,
    lengthCm: line.product.lengthCm ?? env.DEFAULT_PACKAGE_L_CM,
    widthCm: line.product.widthCm ?? env.DEFAULT_PACKAGE_W_CM,
    heightCm: line.product.heightCm ?? env.DEFAULT_PACKAGE_H_CM,
    originPostalCode: env.SHIP_FROM_POSTAL_CODE ?? '',
    destinationPostalCode: '',
  };
}

function bundleParcel(lines: CartLine[], destPostal: string): CanadaPostParcelInput {
  let totalWeight = 0;
  let maxL = 0;
  let maxW = 0;
  let maxH = 0;
  for (const line of lines) {
    const unitG = line.product.weightGrams ?? env.DEFAULT_PACKAGE_WEIGHT_GRAMS;
    totalWeight += unitG * line.quantity;
    maxL = Math.max(maxL, line.product.lengthCm ?? env.DEFAULT_PACKAGE_L_CM);
    maxW = Math.max(maxW, line.product.widthCm ?? env.DEFAULT_PACKAGE_W_CM);
    maxH = Math.max(maxH, line.product.heightCm ?? env.DEFAULT_PACKAGE_H_CM);
  }
  return {
    weightGrams: totalWeight,
    lengthCm: maxL,
    widthCm: maxW,
    heightCm: maxH,
    originPostalCode: env.SHIP_FROM_POSTAL_CODE ?? '',
    destinationPostalCode: destPostal,
  };
}

function parcelsForCart(lines: CartLine[], destPostal: string): CanadaPostParcelInput[] {
  const origin = env.SHIP_FROM_POSTAL_CODE ?? '';
  const separate = lines.filter((l) => l.product.shipsSeparately);
  const bundled = lines.filter((l) => !l.product.shipsSeparately);
  const out: CanadaPostParcelInput[] = [];
  for (const line of separate) {
    const p = lineParcel(line);
    p.originPostalCode = origin;
    p.destinationPostalCode = destPostal;
    out.push(p);
  }
  if (bundled.length > 0) {
    out.push(bundleParcel(bundled, destPostal));
  }
  if (out.length === 0) {
    return [bundleParcel(lines, destPostal)];
  }
  return out;
}

function mergeRatesByServiceCode(
  parcelRates: NormalizedCanadaPostRate[][],
): NormalizedCanadaPostRate[] {
  if (parcelRates.length === 0) return [];
  if (parcelRates.length === 1)
    return [...parcelRates[0]].sort((a, b) => a.amountCents - b.amountCents);
  const firstCodes = new Set(parcelRates[0].map((r) => r.serviceCode));
  const merged: NormalizedCanadaPostRate[] = [];
  for (const code of firstCodes) {
    if (!parcelRates.every((arr) => arr.some((r) => r.serviceCode === code))) continue;
    let cents = 0;
    let name = '';
    let maxDays = 0;
    for (const arr of parcelRates) {
      const r = arr.find((x) => x.serviceCode === code)!;
      cents += r.amountCents;
      name = r.serviceName;
      maxDays = Math.max(maxDays, r.estimatedDeliveryDays ?? 0);
    }
    merged.push({
      serviceCode: code,
      serviceName: name,
      amountCents: cents,
      estimatedDeliveryDays: maxDays > 0 ? maxDays : undefined,
    });
  }
  return merged.sort((a, b) => a.amountCents - b.amountCents);
}

function toRateOptions(
  rows: NormalizedCanadaPostRate[],
  ctx: {
    userId: string;
    cartFingerprint: string;
    destPostalCode: string;
    expiresAtMs: number;
    source: ShippingQuoteSource;
  },
): ShippingRateOption[] {
  const secret = env.SHIPPING_TOKEN_SECRET;
  return rows.slice(0, MAX_QUOTE_OPTIONS).map((r) => {
    const carrier = ctx.source === 'canada_post' ? ('CANADA_POST' as const) : ('FLAT' as const);
    const token = encodeSelectionToken(secret, {
      expiresAtMs: ctx.expiresAtMs,
      userId: ctx.userId,
      cartFingerprint: ctx.cartFingerprint,
      destPostalCode: ctx.destPostalCode,
      serviceCode: r.serviceCode,
      serviceName: r.serviceName,
      amountCents: r.amountCents,
      carrier,
      shipQuoteSource: ctx.source,
      ...(r.estimatedDeliveryDays !== undefined
        ? { estimatedDeliveryDays: r.estimatedDeliveryDays }
        : {}),
    });
    return {
      serviceCode: r.serviceCode,
      serviceName: r.serviceName,
      carrier,
      amountCents: r.amountCents,
      estimatedDeliveryDays: r.estimatedDeliveryDays,
      selectionToken: token,
    };
  });
}

async function fallbackRows(
  subtotalCents: number,
  discountPreview: discountService.DiscountPreview | null,
): Promise<{
  rows: NormalizedCanadaPostRate[];
  forceFree: boolean;
}> {
  const { freeShippingThresholdCents, flatShippingCents } = await getShippingCentsConfig();
  const qualifies =
    subtotalCents >= freeShippingThresholdCents || discountPreview?.type === 'FREE_SHIPPING';
  if (qualifies) {
    return {
      forceFree: true,
      rows: [
        {
          serviceCode: 'FALLBACK.FREE',
          serviceName: 'Free shipping',
          amountCents: 0,
        },
      ],
    };
  }
  return {
    forceFree: false,
    rows: [
      {
        serviceCode: 'FALLBACK.FLAT',
        serviceName: 'Standard shipping',
        amountCents: flatShippingCents,
      },
    ],
  };
}

export async function quoteForCart(
  userId: string,
  dest: QuoteDestinationInput,
): Promise<ShippingQuoteResponse> {
  const destPostal = await resolveDestinationPostal(userId, dest);

  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      discount: true,
      items: {
        include: {
          product: { select: productSelectQuote },
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    throw new HTTPException(400, { message: 'Cart is empty' });
  }

  for (const item of cart.items) {
    if (!item.product.active) {
      throw new HTTPException(409, { message: 'Product no longer available' });
    }
    if (item.product.stock < item.quantity) {
      throw new HTTPException(409, {
        message: `Insufficient stock for ${item.product.name}`,
      });
    }
  }

  const lines: CartLine[] = cart.items.map((it) => ({
    productId: it.productId,
    quantity: it.quantity,
    product: it.product,
  }));

  const subtotalCents = lines.reduce((s, l) => s + l.quantity * l.product.price, 0);

  let discountPreview: discountService.DiscountPreview | null = null;
  if (cart.discountId) {
    const v = await discountService.validateById(cart.discountId, userId, subtotalCents);
    if (!v.ok) {
      discountPreview = null;
    } else {
      discountPreview = v.discount;
    }
  }

  const fingerprint = cartFingerprintFromItems(
    lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
  );
  const expiresAtMs = Date.now() + QUOTE_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();

  const { freeShippingThresholdCents } = await getShippingCentsConfig();
  const { rows: fbRows } = await fallbackRows(subtotalCents, discountPreview);
  const qualifiesFree =
    subtotalCents >= freeShippingThresholdCents || discountPreview?.type === 'FREE_SHIPPING';

  if (qualifiesFree) {
    const options = toRateOptions(fbRows, {
      userId,
      cartFingerprint: fingerprint,
      destPostalCode: destPostal,
      expiresAtMs,
      source: 'fallback',
    });
    return { source: 'fallback', options, expiresAt };
  }

  const parcels = parcelsForCart(lines, destPostal);
  for (const p of parcels) {
    if (isParcelOversized(p)) {
      const options = toRateOptions((await fallbackRows(subtotalCents, discountPreview)).rows, {
        userId,
        cartFingerprint: fingerprint,
        destPostalCode: destPostal,
        expiresAtMs,
        source: 'fallback',
      });
      return { source: 'fallback', options, expiresAt };
    }
  }

  try {
    const parcelRates: NormalizedCanadaPostRate[][] = [];
    for (const parcel of parcels) {
      const rates = await requestCanadaPostRates(parcel);
      parcelRates.push(rates);
    }
    const merged = mergeRatesByServiceCode(parcelRates);
    if (merged.length === 0) {
      throw new CanadaPostClientError('CP_BAD_RESPONSE', 'No merged rates');
    }
    const options = toRateOptions(merged, {
      userId,
      cartFingerprint: fingerprint,
      destPostalCode: destPostal,
      expiresAtMs,
      source: 'canada_post',
    });
    return { source: 'canada_post', options, expiresAt };
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    void e;
    const options = toRateOptions(fbRows, {
      userId,
      cartFingerprint: fingerprint,
      destPostalCode: destPostal,
      expiresAtMs,
      source: 'fallback',
    });
    return { source: 'fallback', options, expiresAt };
  }
}
