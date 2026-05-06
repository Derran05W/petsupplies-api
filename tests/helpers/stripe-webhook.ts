import Stripe from 'stripe';

export function signStripeWebhookPayload(rawBody: string, secret?: string): string {
  const webhookSecret = secret ?? process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required to sign Stripe webhook payloads');
  }
  return Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: webhookSecret,
    timestamp: Math.floor(Date.now() / 1000),
  });
}
