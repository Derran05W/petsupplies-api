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
}

export interface AbandonedCartReminderEmailPayload {
  cartId: string;
  userId: string;
  to: string;
  customerName?: string | null;
  items: EmailLineItem[];
  cartUrl: string;
  subtotalCents: number;
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

export function renderOrderConfirmation(payload: OrderConfirmationEmailPayload): RenderedEmail {
  const subject = 'Your Pet Supplies order is confirmed';
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

export function renderShippingNotification(
  payload: ShippingNotificationEmailPayload,
): RenderedEmail {
  const subject = 'Your Pet Supplies order has shipped';
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

export function renderDeliveryConfirmation(
  payload: DeliveryConfirmationEmailPayload,
): RenderedEmail {
  const subject = 'Your Pet Supplies order was delivered';
  const greetingLine = greeting(payload.customerName);
  const html = `<p>${escapeHtml(greetingLine)}</p>
<p>Order <strong>${escapeHtml(payload.orderId)}</strong> was delivered.</p>
<p><a href="${escapeHtml(payload.orderUrl)}">View your order</a></p>`;

  const text = `${greetingLine}

Order ${payload.orderId} was delivered.

View your order: ${payload.orderUrl}`;

  return { subject, html, text };
}

export function renderBackInStockAlert(payload: BackInStockAlertEmailPayload): RenderedEmail {
  const subject = `${payload.productName} is back in stock`;
  const html = `<p>Good news — <strong>${escapeHtml(payload.productName)}</strong> is back in stock.</p>
<p><a href="${escapeHtml(payload.productUrl)}">View product</a></p>`;

  const text = `Good news — ${payload.productName} is back in stock.

View product: ${payload.productUrl}`;

  return { subject, html, text };
}

export function renderAbandonedCartReminder(
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

export function renderPasswordReset(payload: PasswordResetEmailPayload): RenderedEmail {
  const subject = 'Reset your Pet Supplies password';
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
