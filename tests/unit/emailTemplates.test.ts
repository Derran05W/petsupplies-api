import { describe, it, expect } from 'vitest';
import {
  renderAbandonedCartReminder,
  renderBackInStockAlert,
  renderDeliveryConfirmation,
  renderOrderConfirmation,
  renderPasswordReset,
  renderShippingNotification,
} from '../../src/services/emailTemplates.js';

describe('emailTemplates', () => {
  it('renderOrderConfirmation returns subject, html, and text with payload data', () => {
    const r = renderOrderConfirmation({
      orderId: 'ord_1',
      to: 'a@b.com',
      customerName: 'Sam',
      totalCents: 1234,
      items: [{ productId: 'p1', name: 'Toy', quantity: 2, priceCents: 500 }],
      orderUrl: 'https://app.example.com/orders/ord_1',
    });
    expect(r.subject).toBe('Your Pet Supplies order is confirmed');
    expect(r.html).toContain('ord_1');
    expect(r.html).toContain('Toy');
    expect(r.html).toContain('https://app.example.com/orders/ord_1');
    expect(r.text).toContain('ord_1');
    expect(r.text).toContain('Toy');
    expect(r.text).toContain('$12.34');
  });

  it('renderShippingNotification includes carrier and tracking only (no carrier URL)', () => {
    const r = renderShippingNotification({
      orderId: 'ord_1',
      to: 'a@b.com',
      trackingNumber: 'TRK-9',
      carrier: 'Canada Post',
      orderUrl: 'https://app.example.com/orders/ord_1',
    });
    expect(r.subject).toBe('Your Pet Supplies order has shipped');
    expect(r.html).toContain('Canada Post');
    expect(r.html).toContain('TRK-9');
    expect(r.text).toContain('Canada Post');
    expect(r.text).toContain('TRK-9');
    expect(r.html).not.toContain('http://canadapost');
  });

  it('renderDeliveryConfirmation matches deferred template copy', () => {
    const r = renderDeliveryConfirmation({
      orderId: 'ord_1',
      to: 'a@b.com',
      orderUrl: 'https://app.example.com/orders/ord_1',
    });
    expect(r.subject).toBe('Your Pet Supplies order was delivered');
    expect(r.html).toContain('delivered');
  });

  it('renderBackInStockAlert uses product name in subject', () => {
    const r = renderBackInStockAlert({
      productId: 'p1',
      productName: 'Salmon Treats',
      productUrl: 'https://app.example.com/p/salmon',
      to: 'a@b.com',
    });
    expect(r.subject).toBe('Salmon Treats is back in stock');
    expect(r.html).toContain('Salmon Treats');
  });

  it('renderAbandonedCartReminder includes subtotal and cart link', () => {
    const r = renderAbandonedCartReminder({
      cartId: 'c1',
      userId: 'u1',
      to: 'a@b.com',
      items: [{ productId: 'p1', name: 'Bowl', quantity: 1, priceCents: 900 }],
      cartUrl: 'https://app.example.com/cart',
      subtotalCents: 900,
    });
    expect(r.subject).toBe('Still thinking it over? Your cart is waiting');
    expect(r.html).toContain('$9.00');
    expect(r.text).toContain('https://app.example.com/cart');
  });

  it('renderPasswordReset includes expiry and reset link', () => {
    const r = renderPasswordReset({
      userId: 'u1',
      to: 'a@b.com',
      resetUrl: 'https://app.example.com/reset?token=supersecret',
      expiresInMinutes: 30,
    });
    expect(r.subject).toBe('Reset your Pet Supplies password');
    expect(r.html).toContain('30');
    expect(r.text).toContain('supersecret');
  });
});
