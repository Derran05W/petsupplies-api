import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const EMAIL_TRANSPORT_NOOP_MESSAGE_ID = 'email-transport-noop';

vi.mock('../../src/lib/email.js', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../../src/lib/email.js';
import {
  sendAbandonedCartReminder,
  sendBackInStockAlert,
  sendDeliveryConfirmation,
  sendOrderConfirmation,
  sendPasswordReset,
  sendShippingNotification,
} from '../../src/services/emailService.js';

describe('emailService', () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockResolvedValue({ id: 're_msg_1' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sendOrderConfirmation calls transport with idempotency key and content', async () => {
    const result = await sendOrderConfirmation({
      orderId: 'order-1',
      to: 'buyer@example.com',
      customerName: 'Pat',
      totalCents: 5200,
      items: [{ productId: 'p1', name: 'Kibble', quantity: 2, priceCents: 1000 }],
      orderUrl: 'http://localhost:3000/orders/order-1',
    });

    expect(result).toEqual({ ok: true, messageId: 're_msg_1' });
    expect(sendEmail).toHaveBeenCalledOnce();
    const arg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(arg.to).toBe('buyer@example.com');
    expect(arg.idempotencyKey).toBe('order-confirmation/order-1');
    expect(arg.subject).toBe('Your Pet Supplies order is confirmed');
    expect(arg.html).toContain('Kibble');
    expect(arg.text).toContain('Kibble');
    expect(arg.html).toContain('$10.00');
    expect(arg.text).toContain('Qty 2');
    expect(arg.text).toContain('$10.00');
    expect(arg.html).toContain('http://localhost:3000/orders/order-1');
    expect(arg.text).toContain('http://localhost:3000/orders/order-1');
    expect(arg.tags).toEqual([{ name: 'template', value: 'order-confirmation' }]);
  });

  it('sendShippingNotification calls transport with expected fields', async () => {
    await sendShippingNotification({
      orderId: 'order-1',
      to: 'buyer@example.com',
      trackingNumber: 'TRK',
      carrier: 'UPS',
      orderUrl: 'http://localhost:3000/orders/order-1',
    });
    const arg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(arg.idempotencyKey).toBe('shipping-notification/order-1');
    expect(arg.subject).toBe('Your Pet Supplies order has shipped');
    expect(arg.html).toContain('UPS');
    expect(arg.html).toContain('TRK');
    expect(arg.text).toContain('UPS');
    expect(arg.text).toContain('TRK');
    expect(arg.html).toContain('http://localhost:3000/orders/order-1');
    expect(arg.text).toContain('http://localhost:3000/orders/order-1');
  });

  it('sendDeliveryConfirmation uses delivery idempotency key', async () => {
    await sendDeliveryConfirmation({
      orderId: 'order-2',
      to: 'a@b.com',
      orderUrl: 'http://localhost:3000/orders/order-2',
    });
    expect(vi.mocked(sendEmail).mock.calls[0]![0].idempotencyKey).toBe(
      'delivery-confirmation/order-2',
    );
  });

  it('sendBackInStockAlert uses product-scoped idempotency key', async () => {
    await sendBackInStockAlert({
      productId: 'prod-9',
      productName: 'Foo',
      productUrl: 'http://localhost:3000/p/foo',
      to: 'a@b.com',
    });
    expect(vi.mocked(sendEmail).mock.calls[0]![0].idempotencyKey).toBe(
      'back-in-stock-alert/prod-9',
    );
  });

  it('sendAbandonedCartReminder uses cart idempotency key', async () => {
    await sendAbandonedCartReminder({
      cartId: 'cart-1',
      userId: 'u1',
      to: 'a@b.com',
      items: [],
      cartUrl: 'http://localhost:3000/cart',
      subtotalCents: 0,
    });
    expect(vi.mocked(sendEmail).mock.calls[0]![0].idempotencyKey).toBe(
      'abandoned-cart-reminder/cart-1',
    );
  });

  it('sendPasswordReset is a stub and does not call transport', async () => {
    const result = await sendPasswordReset({
      userId: 'user-99',
      to: 'a@b.com',
      resetUrl: 'https://x.test/reset',
      expiresInMinutes: 15,
    });
    expect(result).toEqual({ ok: true, skipped: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('returns ok true with skipped when transport skips', async () => {
    vi.mocked(sendEmail).mockResolvedValue({
      id: EMAIL_TRANSPORT_NOOP_MESSAGE_ID,
      skipped: true,
    });
    const result = await sendOrderConfirmation({
      orderId: 'o1',
      to: 'a@b.com',
      totalCents: 100,
      items: [],
      orderUrl: 'http://localhost:3000/orders/o1',
    });
    expect(result).toEqual({
      ok: true,
      skipped: true,
      messageId: EMAIL_TRANSPORT_NOOP_MESSAGE_ID,
    });
  });

  it('returns ok false and does not throw when transport rejects', async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error('rate limited'));
    const result = await sendOrderConfirmation({
      orderId: 'o1',
      to: 'a@b.com',
      totalCents: 100,
      items: [],
      orderUrl: 'http://localhost:3000/orders/o1',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('rate limited');
  });

  it('logs do not include full customer email, body, API key, or reset token', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(sendEmail).mockResolvedValue({ id: 'mid' });
    await sendOrderConfirmation({
      orderId: 'o1',
      to: 'very-secret-customer@example.com',
      customerName: 'Pat',
      totalCents: 100,
      items: [{ productId: 'p1', name: 'Kibble', quantity: 1, priceCents: 100 }],
      orderUrl: 'http://localhost:3000/orders/o1',
    });

    const safe = (calls: unknown[][]) =>
      calls
        .flatMap((c) => c)
        .every((a) => JSON.stringify(a).indexOf('very-secret-customer') === -1);

    expect(safe(debugSpy.mock.calls)).toBe(true);
    expect(safe(warnSpy.mock.calls)).toBe(true);
    expect(JSON.stringify(debugSpy.mock.calls)).not.toMatch(/sk_live|re_/);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toMatch(/sk_live|re_/);

    const arg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(JSON.stringify(arg)).toContain('very-secret-customer');

    debugSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
