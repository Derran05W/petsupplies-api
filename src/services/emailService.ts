import { sendEmail, type EmailSendTag } from '../lib/email.js';
import { env } from '../types/env.js';
import type { EmailBrand, RenderedEmail } from './emailTemplates.js';
import { getEmailBrandContext } from './siteSettingsService.js';
import {
  renderAbandonedCartReminder,
  renderBackInStockAlert,
  renderDeliveryConfirmation,
  renderOrderConfirmation,
  renderShippingNotification,
  renderSubscriptionPaymentIssue,
  renderSubscriptionUpcomingDelivery,
  type AbandonedCartReminderEmailPayload,
  type BackInStockAlertEmailPayload,
  type DeliveryConfirmationEmailPayload,
  type OrderConfirmationEmailPayload,
  type PasswordResetEmailPayload,
  type ShippingNotificationEmailPayload,
  type SubscriptionPaymentIssueEmailPayload,
  type SubscriptionUpcomingDeliveryEmailPayload,
} from './emailTemplates.js';

export type {
  EmailLineItem,
  OrderConfirmationEmailPayload,
  ShippingNotificationEmailPayload,
  DeliveryConfirmationEmailPayload,
  BackInStockAlertEmailPayload,
  AbandonedCartReminderEmailPayload,
  PasswordResetEmailPayload,
  SubscriptionPaymentIssueEmailPayload,
  SubscriptionUpcomingDeliveryEmailPayload,
} from './emailTemplates.js';

export type EmailTemplateName =
  | 'order-confirmation'
  | 'shipping-notification'
  | 'delivery-confirmation'
  | 'back-in-stock-alert'
  | 'abandoned-cart-reminder'
  | 'password-reset'
  | 'subscription-upcoming-delivery'
  | 'subscription-payment-issue';

export interface EmailSendResult {
  ok: boolean;
  messageId?: string;
  skipped?: boolean;
  error?: string;
}

type SendTransactionalEmailArgs = {
  template: EmailTemplateName;
  correlationId: string;
  to: string;
  idempotencyKey: string;
  rendered: RenderedEmail;
  tags?: EmailSendTag[];
};

async function loadEmailBrand(): Promise<EmailBrand> {
  const ctx = await getEmailBrandContext();
  return { brandName: ctx.brandName };
}

async function sendTransactionalEmail(args: SendTransactionalEmailArgs): Promise<EmailSendResult> {
  const from = env.EMAIL_FROM?.trim() ?? '';

  const recipientOk = !!args.to.trim();
  if (!recipientOk || !from) {
    const error = !recipientOk ? 'missing recipient email' : 'missing EMAIL_FROM';
    console.warn('[email] transactional send aborted', {
      template: args.template,
      correlationId: args.correlationId,
      error,
    });
    return { ok: false, error };
  }

  try {
    const result = await sendEmail({
      to: args.to,
      from,
      subject: args.rendered.subject,
      html: args.rendered.html,
      text: args.rendered.text,
      idempotencyKey: args.idempotencyKey,
      tags: args.tags ?? [{ name: 'template', value: args.template }],
      noopLog: { template: args.template, correlationId: args.correlationId },
    });

    if (result.skipped) {
      return { ok: true, skipped: true, messageId: result.id };
    }

    console.debug('[email] sent', {
      template: args.template,
      correlationId: args.correlationId,
      providerMessageId: result.id,
    });
    return { ok: true, messageId: result.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.warn('[email] transactional send failed', {
      template: args.template,
      correlationId: args.correlationId,
      error: message,
    });
    return { ok: false, error: message };
  }
}

export async function sendOrderConfirmation(
  payload: OrderConfirmationEmailPayload,
): Promise<EmailSendResult> {
  const brand = await loadEmailBrand();
  const rendered = await renderOrderConfirmation(payload, brand);
  return sendTransactionalEmail({
    template: 'order-confirmation',
    correlationId: payload.orderId,
    to: payload.to,
    idempotencyKey: `order-confirmation/${payload.orderId}`,
    rendered,
  });
}

export async function sendShippingNotification(
  payload: ShippingNotificationEmailPayload,
): Promise<EmailSendResult> {
  const brand = await loadEmailBrand();
  const rendered = await renderShippingNotification(payload, brand);
  return sendTransactionalEmail({
    template: 'shipping-notification',
    correlationId: payload.orderId,
    to: payload.to,
    idempotencyKey: `shipping-notification/${payload.orderId}`,
    rendered,
  });
}

export async function sendDeliveryConfirmation(
  payload: DeliveryConfirmationEmailPayload,
): Promise<EmailSendResult> {
  const brand = await loadEmailBrand();
  const rendered = await renderDeliveryConfirmation(payload, brand);
  return sendTransactionalEmail({
    template: 'delivery-confirmation',
    correlationId: payload.orderId,
    to: payload.to,
    idempotencyKey: `delivery-confirmation/${payload.orderId}`,
    rendered,
  });
}

export async function sendBackInStockAlert(
  payload: BackInStockAlertEmailPayload,
): Promise<EmailSendResult> {
  const rendered = await renderBackInStockAlert(payload);
  return sendTransactionalEmail({
    template: 'back-in-stock-alert',
    correlationId: `${payload.userId}:${payload.productId}`,
    to: payload.to,
    idempotencyKey: `back-in-stock-alert/${payload.userId}/${payload.productId}/${payload.stockAlertEpisode}`,
    rendered,
  });
}

export async function sendAbandonedCartReminder(
  payload: AbandonedCartReminderEmailPayload,
): Promise<EmailSendResult> {
  const rendered = await renderAbandonedCartReminder(payload);
  const runAt = payload.idempotencyRunAt ?? new Date();
  const ymd = runAt.toISOString().slice(0, 10);
  return sendTransactionalEmail({
    template: 'abandoned-cart-reminder',
    correlationId: payload.cartId,
    to: payload.to,
    idempotencyKey: `abandoned-cart/${payload.userId}/${payload.cartId}/${ymd}`,
    rendered,
  });
}

export async function sendPasswordReset(
  payload: PasswordResetEmailPayload,
): Promise<EmailSendResult> {
  console.debug('[email] password reset not sent (stub; Supabase owns auth email)', {
    template: 'password-reset',
    correlationId: payload.userId,
  });
  return { ok: true, skipped: true };
}

export async function sendUpcomingDeliveryReminder(
  payload: SubscriptionUpcomingDeliveryEmailPayload,
): Promise<EmailSendResult> {
  const rendered = await renderSubscriptionUpcomingDelivery(payload);
  const deliveryKey = payload.nextDeliveryAt.toISOString().slice(0, 10);
  return sendTransactionalEmail({
    template: 'subscription-upcoming-delivery',
    correlationId: payload.subscriptionId,
    to: payload.to,
    idempotencyKey: `upcoming-delivery/${payload.subscriptionId}/${deliveryKey}`,
    rendered,
  });
}

export async function sendSubscriptionPaymentIssue(
  payload: SubscriptionPaymentIssueEmailPayload,
): Promise<EmailSendResult> {
  const rendered = await renderSubscriptionPaymentIssue(payload);
  return sendTransactionalEmail({
    template: 'subscription-payment-issue',
    correlationId: payload.subscriptionId,
    to: payload.to,
    idempotencyKey: `subscription-payment-issue/${payload.subscriptionId}/${payload.invoiceId}`,
    rendered,
  });
}
