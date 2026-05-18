import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ShippingCarrier,
  ShippingQuoteSource,
  ShippingSelectionPayload,
} from '../types/shipping.js';

const TOKEN_VERSION = 'v1';

function canonicalMessage(payload: ShippingSelectionPayload): string {
  const est = payload.estimatedDeliveryDays ?? '';
  return [
    TOKEN_VERSION,
    payload.userId,
    payload.cartFingerprint,
    payload.destPostalCode,
    payload.serviceCode,
    String(payload.amountCents),
    String(payload.expiresAtMs),
    payload.serviceName,
    payload.carrier,
    payload.shipQuoteSource,
    String(est),
  ].join('|');
}

function sign(secret: string, msg: string): Buffer {
  return createHmac('sha256', secret).update(msg).digest();
}

export function encodeSelectionToken(secret: string, payload: ShippingSelectionPayload): string {
  const msg = canonicalMessage(payload);
  const sig = sign(secret, msg);
  const json = JSON.stringify({
    ...payload,
    sig: sig.toString('base64url'),
  });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export type VerifySelectionResult =
  | { ok: true; payload: ShippingSelectionPayload }
  | { ok: false; reason: 'INVALID_TOKEN' | 'EXPIRED' | 'BAD_SIGNATURE' };

export function verifySelectionToken(secret: string, token: string): VerifySelectionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }
  const rec = parsed as Record<string, unknown>;
  const sigB64 = rec.sig;
  if (typeof sigB64 !== 'string') return { ok: false, reason: 'INVALID_TOKEN' };

  const expiresAtMs = rec.expiresAtMs;
  const userId = rec.userId;
  const cartFingerprint = rec.cartFingerprint;
  const destPostalCode = rec.destPostalCode;
  const serviceCode = rec.serviceCode;
  const serviceName = rec.serviceName;
  const amountCents = rec.amountCents;
  const carrier = rec.carrier;
  const shipQuoteSource = rec.shipQuoteSource;
  const estimatedDeliveryDays = rec.estimatedDeliveryDays;

  if (
    typeof expiresAtMs !== 'number' ||
    typeof userId !== 'string' ||
    typeof cartFingerprint !== 'string' ||
    typeof destPostalCode !== 'string' ||
    typeof serviceCode !== 'string' ||
    typeof serviceName !== 'string' ||
    typeof amountCents !== 'number' ||
    typeof carrier !== 'string' ||
    typeof shipQuoteSource !== 'string'
  ) {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }

  if (carrier !== 'CANADA_POST' && carrier !== 'FLAT') {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }
  if (shipQuoteSource !== 'canada_post' && shipQuoteSource !== 'fallback') {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }

  const payload: ShippingSelectionPayload = {
    expiresAtMs,
    userId,
    cartFingerprint,
    destPostalCode,
    serviceCode,
    serviceName,
    amountCents,
    carrier: carrier as ShippingCarrier,
    shipQuoteSource: shipQuoteSource as ShippingQuoteSource,
    ...(typeof estimatedDeliveryDays === 'number' ? { estimatedDeliveryDays } : {}),
  };

  const expectedSig = sign(secret, canonicalMessage(payload));
  let got: Buffer;
  try {
    got = Buffer.from(sigB64, 'base64url');
  } catch {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }
  if (got.length !== expectedSig.length || !timingSafeEqual(got, expectedSig)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  if (Date.now() > expiresAtMs) {
    return { ok: false, reason: 'EXPIRED' };
  }

  return { ok: true, payload };
}
