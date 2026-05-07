// RAW BODY INVARIANT: do not add body-parsing middleware above this handler.
// stripe.webhooks.constructEvent requires the unparsed text body.

import { Hono } from 'hono';
import Stripe from 'stripe';
import { stripe } from '../lib/stripe.js';
import { env } from '../types/env.js';
import * as webhookService from '../services/webhookService.js';

export const webhooksRouter = new Hono();

webhooksRouter.post('/stripe', async (c) => {
  const rawBody = await c.req.text();
  const sig = c.req.header('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe signature verification failed', err);
    return c.text('Bad signature', 400);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await webhookService.handleSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case 'checkout.session.expired':
      await webhookService.handleSessionExpired(event.data.object as Stripe.Checkout.Session);
      break;
    case 'payment_intent.payment_failed':
      await webhookService.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
      break;
    case 'customer.subscription.created':
      await webhookService.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
      break;
    case 'customer.subscription.updated':
      await webhookService.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case 'customer.subscription.deleted':
      await webhookService.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    case 'invoice.paid':
      await webhookService.handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    case 'invoice.payment_failed':
      await webhookService.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    default:
      console.log(`[webhook] unhandled event type: ${event.type}`);
  }

  return c.text('ok', 200);
});
