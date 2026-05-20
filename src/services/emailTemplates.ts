import type { EmailTemplateKey } from '../constants/emailTemplateDefaults.js';
import { renderFromDbTemplate } from './emailTemplateService.js';

export type EmailBrand = {
  brandName: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** Line items shared by order confirmation & abandoned cart */
export interface EmailLineItem {
  productId: string;
  name: string;
  quantity: number;
  priceCents: number;
}

export interface OrderConfirmationEmailPayload {
  orderId: string;
  to: string;
  customerName?: string | null;
  totalCents: number;
  items: EmailLineItem[];
  orderUrl: string;
}

export interface ShippingNotificationEmailPayload {
  orderId: string;
  to: string;
  customerName?: string | null;
  trackingNumber: string;
  carrier: string;
  orderUrl: string;
}

export interface DeliveryConfirmationEmailPayload {
  orderId: string;
  to: string;
  customerName?: string | null;
  orderUrl: string;
}

export interface BackInStockAlertEmailPayload {
  productId: string;
  productName: string;
  productUrl: string;
  to: string;
  userId: string;
  /** Bumped when the product last became out of stock; scopes Resend idempotency per restock episode. */
  stockAlertEpisode: number;
}

export interface AbandonedCartReminderEmailPayload {
  cartId: string;
  userId: string;
  to: string;
  customerName?: string | null;
  items: EmailLineItem[];
  cartUrl: string;
  subtotalCents: number;
  /** When set (e.g. cron), idempotency key uses this instant's UTC calendar day */
  idempotencyRunAt?: Date;
}

export interface PasswordResetEmailPayload {
  userId: string;
  to: string;
  customerName?: string | null;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function greeting(name: string | null | undefined): string {
  if (name?.trim()) {
    return `Hi ${name.trim()},`;
  }
  return 'Hi,';
}

function lineItemsHtml(items: EmailLineItem[]): string {
  return `<ul>${items
    .map(
      (i) =>
        `<li>${escapeHtml(i.name)} — Qty ${i.quantity} — ${escapeHtml(formatMoney(i.priceCents))} each</li>`,
    )
    .join('')}</ul>`;
}

function lineItemsText(items: EmailLineItem[]): string {
  return items
    .map((i) => `- ${i.name} — Qty ${i.quantity} — ${formatMoney(i.priceCents)} each`)
    .join('\n');
}

async function renderWithDbOrLegacy(
  key: EmailTemplateKey,
  vars: Record<string, string>,
  legacy: () => RenderedEmail,
): Promise<RenderedEmail> {
  const fromDb = await renderFromDbTemplate(key, vars);
  if (fromDb) return fromDb;
  return legacy();
}

function legacyRenderOrderConfirmation(
  payload: OrderConfirmationEmailPayload,
  brand: EmailBrand,
): RenderedEmail {
  const subject = `Your ${brand.brandName} order is confirmed`;
  const greetingLine = greeting(payload.customerName);
  const html = `<p>${escapeHtml(greetingLine)}</p>
<p>Thanks for your order. Your order <strong>${escapeHtml(payload.orderId)}</strong> is confirmed.</p>
<p><a href="${escapeHtml(payload.orderUrl)}">View your order</a></p>
<p>Items:</p>
${lineItemsHtml(payload.items)}
<p>Total: <strong>${escapeHtml(formatMoney(payload.totalCents))}</strong></p>
<p>If you did not place this order, please contact support.</p>`;

  const text = `${greetingLine}

Thanks for your order. Your order ${payload.orderId} is confirmed.

View your order: ${payload.orderUrl}

Items:
${lineItemsText(payload.items)}

Total: ${formatMoney(payload.totalCents)}

If you did not place this order, please contact support.`;

  return { subject, html, text };
}

function legacyRenderShippingNotification(
  payload: ShippingNotificationEmailPayload,
  brand: EmailBrand,
): RenderedEmail {
  const subject = `Your ${brand.brandName} order has shipped`;
  const greetingLine = greeting(payload.customerName);
  const html = `<p>${escapeHtml(greetingLine)}</p>
<p>Order <strong>${escapeHtml(payload.orderId)}</strong> has shipped.</p>
<p>Carrier: ${escapeHtml(payload.carrier)}</p>
<p>Tracking number: ${escapeHtml(payload.trackingNumber)}</p>
<p><a href="${escapeHtml(payload.orderUrl)}">View your order</a></p>`;

  const text = `${greetingLine}

Order ${payload.orderId} has shipped.

Carrier: ${payload.carrier}
Tracking number: ${payload.trackingNumber}

View your order: ${payload.orderUrl}`;

  return { subject, html, text };
}

function legacyRenderDeliveryConfirmation(
  payload: DeliveryConfirmationEmailPayload,
  brand: EmailBrand,
): RenderedEmail {
  const subject = `Your ${brand.brandName} order was delivered`;
  const greetingLine = greeting(payload.customerName);
  const html = `<p>${escapeHtml(greetingLine)}</p>
<p>Order <strong>${escapeHtml(payload.orderId)}</strong> was delivered.</p>
<p><a href="${escapeHtml(payload.orderUrl)}">View your order</a></p>`;

  const text = `${greetingLine}

Order ${payload.orderId} was delivered.

View your order: ${payload.orderUrl}`;

  return { subject, html, text };
}

function legacyRenderBackInStockAlert(payload: BackInStockAlertEmailPayload): RenderedEmail {
  const subject = `${payload.productName} is back in stock`;
  const html = `<p>Good news — <strong>${escapeHtml(payload.productName)}</strong> is back in stock.</p>
<p><a href="${escapeHtml(payload.productUrl)}">View product</a></p>`;

  const text = `Good news — ${payload.productName} is back in stock.

View product: ${payload.productUrl}`;

  return { subject, html, text };
}

function legacyRenderAbandonedCartReminder(
  payload: AbandonedCartReminderEmailPayload,
): RenderedEmail {
  const subject = 'Still thinking it over? Your cart is waiting';
  const greetingLine = greeting(payload.customerName);
  const html = `<p>${escapeHtml(greetingLine)}</p>
<p>You left some items in your cart. Subtotal: <strong>${escapeHtml(formatMoney(payload.subtotalCents))}</strong></p>
${lineItemsHtml(payload.items)}
<p><a href="${escapeHtml(payload.cartUrl)}">Return to your cart</a></p>`;

  const text = `${greetingLine}

You left some items in your cart. Subtotal: ${formatMoney(payload.subtotalCents)}.

${lineItemsText(payload.items)}

Return to your cart: ${payload.cartUrl}`;

  return { subject, html, text };
}

function legacyRenderPasswordReset(
  payload: PasswordResetEmailPayload,
  brand: EmailBrand,
): RenderedEmail {
  const subject = `Reset your ${brand.brandName} password`;
  const greetingLine = greeting(payload.customerName);
  const html = `<p>${escapeHtml(greetingLine)}</p>
<p>We received a request to reset your password. This link expires in ${payload.expiresInMinutes} minutes.</p>
<p><a href="${escapeHtml(payload.resetUrl)}">Reset password</a></p>
<p>If you did not request this, you can ignore this email.</p>`;

  const text = `${greetingLine}

We received a request to reset your password. This link expires in ${payload.expiresInMinutes} minutes.

Reset password: ${payload.resetUrl}

If you did not request this, you can ignore this email.`;

  return { subject, html, text };
}

function legacyRenderSubscriptionUpcomingDelivery(
  payload: SubscriptionUpcomingDeliveryEmailPayload,
): RenderedEmail {
  const subject = `Your Subscribe & Save delivery is coming up (${payload.deliveryDateLabel})`;
  const greetingLine = greeting(payload.customerName);
  const petLine = payload.petName
    ? `<p>For <strong>${escapeHtml(payload.petName)}</strong></p>`
    : '';
  const petLineText = payload.petName ? `\nFor ${payload.petName}` : '';

  const html = `<p>${escapeHtml(greetingLine)}</p>
<p>Your next Subscribe & Save shipment for <strong>${escapeHtml(payload.productName)}</strong> is scheduled around <strong>${escapeHtml(payload.deliveryDateLabel)}</strong>.</p>
${petLine}
<p><a href="${escapeHtml(payload.productUrl)}">View product</a></p>
<p>You can manage delivery anytime from your account.</p>`;

  const text = `${greetingLine}

Your next Subscribe & Save shipment for ${payload.productName} is scheduled around ${payload.deliveryDateLabel}.${petLineText}

View product: ${payload.productUrl}

You can manage delivery anytime from your account.`;

  return { subject, html, text };
}

function legacyRenderSubscriptionPaymentIssue(
  payload: SubscriptionPaymentIssueEmailPayload,
): RenderedEmail {
  const subject = 'We hit a snag with your latest delivery';
  const greetingLine = greeting(payload.customerName);
  const html = `<p>${escapeHtml(greetingLine)}</p>
<p>We hit a snag with your latest delivery — our team has been notified.</p>
<p>You do not need to do anything right now; we will follow up if we need more information.</p>`;

  const text = `${greetingLine}

We hit a snag with your latest delivery — our team has been notified.

You do not need to do anything right now; we will follow up if we need more information.`;

  return { subject, html, text };
}

export async function renderOrderConfirmation(
  payload: OrderConfirmationEmailPayload,
  brand: EmailBrand,
): Promise<RenderedEmail> {
  const greetingLine = greeting(payload.customerName);
  return renderWithDbOrLegacy(
    'order-confirmation',
    {
      greeting: greetingLine,
      'order.number': payload.orderId,
      'order.url': payload.orderUrl,
      'order.total': formatMoney(payload.totalCents),
      lineItems: lineItemsHtml(payload.items),
      'brand.name': brand.brandName,
    },
    () => legacyRenderOrderConfirmation(payload, brand),
  );
}

export async function renderShippingNotification(
  payload: ShippingNotificationEmailPayload,
  brand: EmailBrand,
): Promise<RenderedEmail> {
  const greetingLine = greeting(payload.customerName);
  return renderWithDbOrLegacy(
    'shipping-notification',
    {
      greeting: greetingLine,
      'order.number': payload.orderId,
      'order.url': payload.orderUrl,
      'order.carrier': payload.carrier,
      'order.trackingNumber': payload.trackingNumber,
      'brand.name': brand.brandName,
    },
    () => legacyRenderShippingNotification(payload, brand),
  );
}

export async function renderDeliveryConfirmation(
  payload: DeliveryConfirmationEmailPayload,
  brand: EmailBrand,
): Promise<RenderedEmail> {
  const greetingLine = greeting(payload.customerName);
  return renderWithDbOrLegacy(
    'delivery-confirmation',
    {
      greeting: greetingLine,
      'order.number': payload.orderId,
      'order.url': payload.orderUrl,
      'brand.name': brand.brandName,
    },
    () => legacyRenderDeliveryConfirmation(payload, brand),
  );
}

export async function renderBackInStockAlert(
  payload: BackInStockAlertEmailPayload,
): Promise<RenderedEmail> {
  return renderWithDbOrLegacy(
    'back-in-stock-alert',
    {
      'product.name': payload.productName,
      'product.url': payload.productUrl,
    },
    () => legacyRenderBackInStockAlert(payload),
  );
}

export async function renderAbandonedCartReminder(
  payload: AbandonedCartReminderEmailPayload,
): Promise<RenderedEmail> {
  const greetingLine = greeting(payload.customerName);
  return renderWithDbOrLegacy(
    'abandoned-cart-reminder',
    {
      greeting: greetingLine,
      'cart.url': payload.cartUrl,
      'cart.subtotal': formatMoney(payload.subtotalCents),
      lineItems: lineItemsHtml(payload.items),
    },
    () => legacyRenderAbandonedCartReminder(payload),
  );
}

export async function renderPasswordReset(
  payload: PasswordResetEmailPayload,
  brand: EmailBrand,
): Promise<RenderedEmail> {
  const greetingLine = greeting(payload.customerName);
  return renderWithDbOrLegacy(
    'password-reset',
    {
      greeting: greetingLine,
      'reset.url': payload.resetUrl,
      'reset.expiresMinutes': String(payload.expiresInMinutes),
      'brand.name': brand.brandName,
    },
    () => legacyRenderPasswordReset(payload, brand),
  );
}

export interface SubscriptionUpcomingDeliveryEmailPayload {
  subscriptionId: string;
  to: string;
  customerName?: string | null;
  nextDeliveryAt: Date;
  productName: string;
  productUrl: string;
  petName?: string | null;
  deliveryDateLabel: string;
}

export interface SubscriptionPaymentIssueEmailPayload {
  subscriptionId: string;
  to: string;
  invoiceId: string;
  customerName?: string | null;
}

export async function renderSubscriptionUpcomingDelivery(
  payload: SubscriptionUpcomingDeliveryEmailPayload,
): Promise<RenderedEmail> {
  const greetingLine = greeting(payload.customerName);
  const petLine = payload.petName
    ? `<p>For <strong>${escapeHtml(payload.petName)}</strong></p>`
    : '';
  const petLineText = payload.petName ? `\nFor ${payload.petName}` : '';

  return renderWithDbOrLegacy(
    'subscription-upcoming-delivery',
    {
      greeting: greetingLine,
      'product.name': payload.productName,
      'product.url': payload.productUrl,
      'delivery.dateLabel': payload.deliveryDateLabel,
      'pet.line': petLine,
      'pet.lineText': petLineText,
    },
    () => legacyRenderSubscriptionUpcomingDelivery(payload),
  );
}

export async function renderSubscriptionPaymentIssue(
  payload: SubscriptionPaymentIssueEmailPayload,
): Promise<RenderedEmail> {
  const greetingLine = greeting(payload.customerName);
  return renderWithDbOrLegacy('subscription-payment-issue', { greeting: greetingLine }, () =>
    legacyRenderSubscriptionPaymentIssue(payload),
  );
}

/** Synchronous legacy renders exported for snapshot baseline tests. */
export const legacyEmailRenders = {
  orderConfirmation: legacyRenderOrderConfirmation,
  shippingNotification: legacyRenderShippingNotification,
  deliveryConfirmation: legacyRenderDeliveryConfirmation,
  backInStockAlert: legacyRenderBackInStockAlert,
  abandonedCartReminder: legacyRenderAbandonedCartReminder,
  passwordReset: legacyRenderPasswordReset,
  subscriptionUpcomingDelivery: legacyRenderSubscriptionUpcomingDelivery,
  subscriptionPaymentIssue: legacyRenderSubscriptionPaymentIssue,
};
