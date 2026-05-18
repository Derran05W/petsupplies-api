export type ShippingQuoteSource = 'canada_post' | 'fallback';

export type ShippingCarrier = 'CANADA_POST' | 'FLAT';

export interface ShippingRateOption {
  serviceCode: string;
  serviceName: string;
  carrier: ShippingCarrier;
  amountCents: number;
  estimatedDeliveryDays?: number;
  selectionToken: string;
}

export interface ShippingQuoteResponse {
  source: ShippingQuoteSource;
  options: ShippingRateOption[];
  expiresAt: string;
}

export interface ShippingSelectionPayload {
  expiresAtMs: number;
  userId: string;
  cartFingerprint: string;
  destPostalCode: string;
  serviceCode: string;
  serviceName: string;
  amountCents: number;
  carrier: ShippingCarrier;
  estimatedDeliveryDays?: number;
  shipQuoteSource: ShippingQuoteSource;
}
