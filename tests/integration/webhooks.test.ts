import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

vi.mock('../../src/services/webhookService.js', () => ({
  handleSessionCompleted: vi.fn(),
  handleSessionExpired: vi.fn(),
  handlePaymentIntentFailed: vi.fn(),
}));

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
}));

import { createApp } from '../../src/app.js';
import { stripe } from '../../src/lib/stripe.js';
import * as webhookService from '../../src/services/webhookService.js';

describe('POST /webhooks/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when Stripe signature verification fails', async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => {
      throw new Error('bad sig');
    });
    const app = createApp();
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid' },
      body: '{"x":true}',
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 for unknown types without calling webhookService', async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      id: 'evt_123',
      type: 'billing.report_some.unknown.event',
      data: { object: {} },
    } as unknown as Stripe.Event);

    const app = createApp();
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: '{}',
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(webhookService.handleSessionCompleted).not.toHaveBeenCalled();
  });

  it('dispatches checkout.session.completed and responds 200', async () => {
    const session = { id: 'cs_1', object: 'checkout.session' } as Stripe.Checkout.Session;
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      id: 'evt_completed',
      type: 'checkout.session.completed',
      data: { object: session },
    } as Stripe.Event);

    vi.mocked(webhookService.handleSessionCompleted).mockResolvedValue(undefined);

    const app = createApp();
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid' },
      body: '{"type":"checkout.session.completed"}',
    });

    expect(res.status).toBe(200);
    expect(webhookService.handleSessionCompleted).toHaveBeenCalledWith(session);
  });
});
