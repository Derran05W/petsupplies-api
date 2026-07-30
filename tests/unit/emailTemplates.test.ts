import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/emailTemplateService.js', () => ({
  renderFromDbTemplate: vi.fn().mockResolvedValue(null),
}));

import {
  formatMoney,
  legacyEmailRenders,
  renderAbandonedCartReminder,
  renderBackInStockAlert,
  renderDeliveryConfirmation,
  renderOrderConfirmation,
  renderPasswordReset,
  renderShippingNotification,
  renderSubscriptionPaymentIssue,
  renderSubscriptionUpcomingDelivery,
} from '../../src/services/emailTemplates.js';

const testBrand = { brandName: "Aileen's petstore" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('emailTemplates (legacy fallback)', () => {
  it('formats email amounts explicitly in CAD', () => {
    const formatted = formatMoney(1234);

    expect(formatted).toContain('CAD');
    expect(formatted).toContain('12.34');
    expect(formatted).not.toContain('USD');
  });

  it('renderOrderConfirmation returns subject, html, and text with payload data', async () => {
    const r = await renderOrderConfirmation(
      {
        orderId: 'ord_1',
        to: 'a@b.com',
        customerName: 'Sam',
        totalCents: 1234,
        items: [{ productId: 'p1', name: 'Toy', quantity: 2, priceCents: 500 }],
        orderUrl: 'https://app.example.com/orders/ord_1',
      },
      testBrand,
    );
    expect(r.subject).toBe("Your Aileen's petstore order is confirmed");
    expect(r.html).toContain('ord_1');
    expect(r.html).toContain('Toy');
    expect(r.html).toContain('https://app.example.com/orders/ord_1');
    expect(r.text).toContain('ord_1');
    expect(r.text).toContain('Toy');
    expect(r.text).toContain('CAD');
    expect(r.text).toContain('12.34');
  });

  it('renderShippingNotification includes carrier and tracking only (no carrier URL)', async () => {
    const r = await renderShippingNotification(
      {
        orderId: 'ord_1',
        to: 'a@b.com',
        trackingNumber: 'TRK-9',
        carrier: 'Canada Post',
        orderUrl: 'https://app.example.com/orders/ord_1',
      },
      testBrand,
    );
    expect(r.subject).toBe("Your Aileen's petstore order has shipped");
    expect(r.html).toContain('Canada Post');
    expect(r.html).toContain('TRK-9');
    expect(r.text).toContain('Canada Post');
    expect(r.text).toContain('TRK-9');
    expect(r.html).not.toContain('http://canadapost');
  });

  it('renderDeliveryConfirmation matches deferred template copy', async () => {
    const r = await renderDeliveryConfirmation(
      {
        orderId: 'ord_1',
        to: 'a@b.com',
        orderUrl: 'https://app.example.com/orders/ord_1',
      },
      testBrand,
    );
    expect(r.subject).toBe("Your Aileen's petstore order was delivered");
    expect(r.html).toContain('delivered');
  });

  it('renderBackInStockAlert uses product name in subject', async () => {
    const r = await renderBackInStockAlert({
      productId: 'p1',
      productName: 'Salmon Treats',
      productUrl: 'https://app.example.com/p/salmon',
      to: 'a@b.com',
      userId: 'u1',
      stockAlertEpisode: 2,
    });
    expect(r.subject).toBe('Salmon Treats is back in stock');
    expect(r.html).toContain('Salmon Treats');
  });

  it('renderAbandonedCartReminder includes subtotal and cart link', async () => {
    const r = await renderAbandonedCartReminder({
      cartId: 'c1',
      userId: 'u1',
      to: 'a@b.com',
      items: [{ productId: 'p1', name: 'Bowl', quantity: 1, priceCents: 900 }],
      cartUrl: 'https://app.example.com/cart',
      subtotalCents: 900,
    });
    expect(r.subject).toBe('Still thinking it over? Your cart is waiting');
    expect(r.html).toContain('CAD');
    expect(r.html).toContain('9.00');
    expect(r.text).toContain('https://app.example.com/cart');
  });

  it('renderPasswordReset includes expiry and reset link', async () => {
    const r = await renderPasswordReset(
      {
        userId: 'u1',
        to: 'a@b.com',
        resetUrl: 'https://app.example.com/reset?token=supersecret',
        expiresInMinutes: 30,
      },
      testBrand,
    );
    expect(r.subject).toBe("Reset your Aileen's petstore password");
    expect(r.html).toContain('30');
    expect(r.text).toContain('supersecret');
  });

  it('renderSubscriptionUpcomingDelivery escapes product and pet fields', async () => {
    const r = await renderSubscriptionUpcomingDelivery({
      subscriptionId: 's1',
      to: 'a@b.com',
      customerName: 'Sam',
      nextDeliveryAt: new Date('2026-06-01T00:00:00.000Z'),
      productName: 'Fish <flakes>',
      productUrl: 'https://app.example.com/products/fish',
      petName: 'Nemo & friends',
      deliveryDateLabel: '2026-06-01',
    });
    expect(r.subject).toContain('2026-06-01');
    expect(r.html).toContain('&lt;flakes&gt;');
    expect(r.html).not.toContain('<flakes>');
    expect(r.html).toContain('Nemo &amp; friends');
  });

  it('renderSubscriptionPaymentIssue uses neutral copy', async () => {
    const r = await renderSubscriptionPaymentIssue({
      subscriptionId: 's1',
      to: 'a@b.com',
      invoiceId: 'in_1',
      customerName: 'Sam',
    });
    expect(r.subject).toContain('snag');
    expect(r.html.toLowerCase()).not.toContain('refund');
  });

  it('legacyEmailRenders.orderConfirmation matches async fallback output', async () => {
    const payload = {
      orderId: 'ord_1',
      to: 'a@b.com',
      customerName: 'Sam',
      totalCents: 1234,
      items: [{ productId: 'p1', name: 'Toy', quantity: 2, priceCents: 500 }],
      orderUrl: 'https://app.example.com/orders/ord_1',
    };
    const legacy = legacyEmailRenders.orderConfirmation(payload, testBrand);
    const rendered = await renderOrderConfirmation(payload, testBrand);
    expect(rendered.subject).toBe(legacy.subject);
    expect(rendered.text).toBe(legacy.text);
  });
});
