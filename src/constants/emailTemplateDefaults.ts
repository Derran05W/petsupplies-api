/** Keys align with EmailTemplateName in emailService.ts */
export const EMAIL_TEMPLATE_KEYS = [
  'order-confirmation',
  'shipping-notification',
  'delivery-confirmation',
  'back-in-stock-alert',
  'abandoned-cart-reminder',
  'password-reset',
  'subscription-upcoming-delivery',
  'subscription-payment-issue',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export type EmailTemplateSeed = {
  key: EmailTemplateKey;
  subject: string;
  preheader: string | null;
  bodyMarkdown: string;
};

/** Mustache-style placeholders; validated at admin write and render time. */
export const EMAIL_TEMPLATE_ALLOWED_VARS: Record<EmailTemplateKey, readonly string[]> = {
  'order-confirmation': [
    'brand.name',
    'greeting',
    'order.number',
    'order.url',
    'order.total',
    'lineItems',
  ],
  'shipping-notification': [
    'brand.name',
    'greeting',
    'order.number',
    'order.url',
    'order.carrier',
    'order.trackingNumber',
  ],
  'delivery-confirmation': ['brand.name', 'greeting', 'order.number', 'order.url'],
  'back-in-stock-alert': ['product.name', 'product.url'],
  'abandoned-cart-reminder': ['greeting', 'cart.url', 'cart.subtotal', 'lineItems'],
  'password-reset': ['brand.name', 'greeting', 'reset.url', 'reset.expiresMinutes'],
  'subscription-upcoming-delivery': [
    'greeting',
    'product.name',
    'product.url',
    'delivery.dateLabel',
    'pet.line',
    'pet.lineText',
  ],
  'subscription-payment-issue': ['greeting'],
};

export const EMAIL_TEMPLATE_SEED_DEFAULTS: EmailTemplateSeed[] = [
  {
    key: 'order-confirmation',
    subject: 'Your {{brand.name}} order is confirmed',
    preheader: null,
    bodyMarkdown: `{{greeting}}

Thanks for your order. Your order **{{order.number}}** is confirmed.

[View your order]({{order.url}})

Items:

{{lineItems}}

Total: **{{order.total}}**

If you did not place this order, please contact support.`,
  },
  {
    key: 'shipping-notification',
    subject: 'Your {{brand.name}} order has shipped',
    preheader: null,
    bodyMarkdown: `{{greeting}}

Order **{{order.number}}** has shipped.

Carrier: {{order.carrier}}

Tracking number: {{order.trackingNumber}}

[View your order]({{order.url}})`,
  },
  {
    key: 'delivery-confirmation',
    subject: 'Your {{brand.name}} order was delivered',
    preheader: null,
    bodyMarkdown: `{{greeting}}

Order **{{order.number}}** was delivered.

[View your order]({{order.url}})`,
  },
  {
    key: 'back-in-stock-alert',
    subject: '{{product.name}} is back in stock',
    preheader: null,
    bodyMarkdown: `Good news — **{{product.name}}** is back in stock.

[View product]({{product.url}})`,
  },
  {
    key: 'abandoned-cart-reminder',
    subject: 'Still thinking it over? Your cart is waiting',
    preheader: null,
    bodyMarkdown: `{{greeting}}

You left some items in your cart. Subtotal: **{{cart.subtotal}}**

{{lineItems}}

[Return to your cart]({{cart.url}})`,
  },
  {
    key: 'password-reset',
    subject: 'Reset your {{brand.name}} password',
    preheader: null,
    bodyMarkdown: `{{greeting}}

We received a request to reset your password. This link expires in {{reset.expiresMinutes}} minutes.

[Reset password]({{reset.url}})

If you did not request this, you can ignore this email.`,
  },
  {
    key: 'subscription-upcoming-delivery',
    subject: 'Your Subscribe & Save delivery is coming up ({{delivery.dateLabel}})',
    preheader: null,
    bodyMarkdown: `{{greeting}}

Your next Subscribe & Save shipment for **{{product.name}}** is scheduled around **{{delivery.dateLabel}}**.

{{pet.line}}

[View product]({{product.url}})

You can manage delivery anytime from your account.`,
  },
  {
    key: 'subscription-payment-issue',
    subject: 'We hit a snag with your latest delivery',
    preheader: null,
    bodyMarkdown: `{{greeting}}

We hit a snag with your latest delivery — our team has been notified.

You do not need to do anything right now; we will follow up if we need more information.`,
  },
];
