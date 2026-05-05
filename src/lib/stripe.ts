import Stripe from 'stripe';
import { env } from '../types/env.js';

const globalForStripe = globalThis as unknown as { stripe?: Stripe };

export const stripe =
  globalForStripe.stripe ??
  new Stripe(env.STRIPE_SECRET_KEY, {
    typescript: true,
  });

if (env.NODE_ENV !== 'production') {
  globalForStripe.stripe = stripe;
}
