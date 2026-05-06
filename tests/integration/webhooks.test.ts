import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

// Mock the service layer so tests don't hit the DB. Do NOT mock src/lib/stripe.js —
// we want the real Stripe.webhooks.constructEvent to verify signatures, since that
// path is the security boundary we most want covered by integration tests.
vi.mock('../../src/services/webhookService.js', () => ({
  handleSessionCompleted: vi.fn(),
  handleSessionExpired: vi.fn(),
  handlePaymentIntentFailed: vi.fn(),
}));

import { createApp } from '../../src/app.js';
import * as webhookService from '../../src/services/webhookService.js';

const TEST_SECRET = 'whsec_test';

function sign(rawBody: string, secret: string = TEST_SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret,
    timestamp: Math.floor(Date.now() / 1000),
  });
}

function eventBody(type: string, data: object): string {
  return JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: { object: data },
  });
}

describe('POST /webhooks/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when stripe-signature header is garbage', async () => {
    const app = createApp();
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'not-a-real-signature' },
      body: eventBody('checkout.session.completed', { id: 'cs_1' }),
    });

    expect(res.status).toBe(400);
    expect(webhookService.handleSessionCompleted).not.toHaveBeenCalled();
  });

  it('returns 400 when payload is signed with the wrong secret', async () => {
    const body = eventBody('checkout.session.completed', { id: 'cs_1' });
    const app = createApp();
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': sign(body, 'whsec_wrong_secret') },
      body,
    });

    expect(res.status).toBe(400);
    expect(webhookService.handleSessionCompleted).not.toHaveBeenCalled();
  });

  it('returns 200 for unknown event types without dispatching to a handler', async () => {
    const body = eventBody('billing.report.something', {});
    const app = createApp();
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': sign(body) },
      body,
    });

    expect(res.status).toBe(200);
    expect(webhookService.handleSessionCompleted).not.toHaveBeenCalled();
    expect(webhookService.handleSessionExpired).not.toHaveBeenCalled();
    expect(webhookService.handlePaymentIntentFailed).not.toHaveBeenCalled();
  });

  it('dispatches checkout.session.completed and responds 200', async () => {
    const session = { id: 'cs_completed_1', object: 'checkout.session' };
    const body = eventBody('checkout.session.completed', session);
    const app = createApp();
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': sign(body) },
      body,
    });

    expect(res.status).toBe(200);
    expect(webhookService.handleSessionCompleted).toHaveBeenCalledOnce();
    expect(vi.mocked(webhookService.handleSessionCompleted).mock.calls[0]?.[0]).toMatchObject({
      id: 'cs_completed_1',
    });
  });

  it('dispatches checkout.session.expired and responds 200', async () => {
    const session = { id: 'cs_expired_1', object: 'checkout.session' };
    const body = eventBody('checkout.session.expired', session);
    const app = createApp();
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': sign(body) },
      body,
    });

    expect(res.status).toBe(200);
    expect(webhookService.handleSessionExpired).toHaveBeenCalledOnce();
    expect(vi.mocked(webhookService.handleSessionExpired).mock.calls[0]?.[0]).toMatchObject({
      id: 'cs_expired_1',
    });
  });

  it('dispatches payment_intent.payment_failed and responds 200', async () => {
    const intent = {
      id: 'pi_failed_1',
      object: 'payment_intent',
      metadata: { orderId: 'order-1' },
    };
    const body = eventBody('payment_intent.payment_failed', intent);
    const app = createApp();
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': sign(body) },
      body,
    });

    expect(res.status).toBe(200);
    expect(webhookService.handlePaymentIntentFailed).toHaveBeenCalledOnce();
    expect(vi.mocked(webhookService.handlePaymentIntentFailed).mock.calls[0]?.[0]).toMatchObject({
      id: 'pi_failed_1',
      metadata: { orderId: 'order-1' },
    });
  });
});
