import { describe, it, expect, vi } from 'vitest';
import Stripe from 'stripe';

// Mirrors tests/integration/webhooks.test.ts: mock the service layer so this route never
// touches the DB. Not strictly required for the cases below (both use an unhandled event
// type, so no handler is dispatched), but kept for consistency/defensiveness.
vi.mock('../../src/services/webhookService.js', () => ({
  handleSessionCompleted: vi.fn(),
  handleSessionExpired: vi.fn(),
  handlePaymentIntentFailed: vi.fn(),
  handleSubscriptionCreated: vi.fn(),
  handleSubscriptionUpdated: vi.fn(),
  handleSubscriptionDeleted: vi.fn(),
  handleInvoicePaid: vi.fn(),
  handleInvoicePaymentFailed: vi.fn(),
}));

import { createApp } from '../../src/app.js';

// Matches STRIPE_WEBHOOK_SECRET set in tests/setup.ts
const WEBHOOK_TEST_SECRET = 'whsec_test';

function signWebhookBody(rawBody: string): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: WEBHOOK_TEST_SECRET,
    timestamp: Math.floor(Date.now() / 1000),
  });
}

describe('secureHeaders (C1)', () => {
  it('sets baseline security headers on a normal response', async () => {
    const app = createApp();
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });
});

describe('body-size limit (C2)', () => {
  it('rejects an oversized body on a normal POST route with 413', async () => {
    const app = createApp();
    const res = await app.request('/checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(300_000) }),
    });

    expect(res.status).toBe(413);
  });

  it('does not apply to the Stripe webhook route (raw-body invariant)', async () => {
    const body = JSON.stringify({
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type: 'billing.report.something', // unhandled type — no handler dispatch needed
      data: { object: { padding: 'x'.repeat(300_000) } },
    });
    // Sanity-check the fixture is actually over the 256KB limit, so this test would fail
    // loudly (rather than vacuously pass) if that padding size is ever trimmed down.
    expect(body.length).toBeGreaterThan(256 * 1024);

    const app = createApp();
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signWebhookBody(body) },
      body,
    });

    expect(res.status).toBe(200);
  });
});
