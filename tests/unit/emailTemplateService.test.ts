import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMAIL_TEMPLATE_SEED_DEFAULTS } from '../../src/constants/emailTemplateDefaults.js';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    emailTemplate: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/siteSettingsService.js', () => ({
  getEmailBrandContext: vi.fn().mockResolvedValue({
    brandName: "Aileen's petstore",
    supportEmail: 'hello@example.com',
    frontendUrl: 'https://app.example.com',
  }),
}));

vi.mock('../../src/services/revalidationService.js', () => ({
  revalidateFrontendTags: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma.js';
import * as emailTemplateService from '../../src/services/emailTemplateService.js';
import {
  legacyEmailRenders,
  renderOrderConfirmation,
  type OrderConfirmationEmailPayload,
} from '../../src/services/emailTemplates.js';

const orderPayload: OrderConfirmationEmailPayload = {
  orderId: 'ord_1',
  to: 'a@b.com',
  customerName: 'Sam',
  totalCents: 1234,
  items: [{ productId: 'p1', name: 'Toy', quantity: 2, priceCents: 500 }],
  orderUrl: 'https://app.example.com/orders/ord_1',
};

const testBrand = { brandName: "Aileen's petstore" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('emailTemplateService', () => {
  it('substituteTemplateVariables replaces missing vars with empty string', () => {
    const out = emailTemplateService.substituteTemplateVariables('Hi {{name}}!', {});
    expect(out).toBe('Hi !');
  });

  it('validateTemplateVariables rejects unknown placeholders', () => {
    expect(() =>
      emailTemplateService.validateTemplateVariables('Hello {{evil}}', 'order-confirmation'),
    ).toThrow();
  });

  it('upsertEmailTemplate rejects invalid variables', async () => {
    await expect(
      emailTemplateService.upsertEmailTemplate('order-confirmation', {
        subject: 'Hi {{evil}}',
        bodyMarkdown: 'Ok',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('DB templates match legacy output (seed snapshots)', () => {
  for (const seed of EMAIL_TEMPLATE_SEED_DEFAULTS) {
    it(`seeded ${seed.key} renders same subject as legacy`, async () => {
      vi.mocked(prisma.emailTemplate.findUnique).mockResolvedValue({
        key: seed.key,
        subject: seed.subject,
        preheader: seed.preheader,
        bodyMarkdown: seed.bodyMarkdown,
        updatedAt: new Date(),
      });

      if (seed.key === 'order-confirmation') {
        const legacy = legacyEmailRenders.orderConfirmation(orderPayload, testBrand);
        const fromDb = await renderOrderConfirmation(orderPayload, testBrand);
        expect(fromDb.subject).toBe(legacy.subject);
        expect(fromDb.text).toContain('ord_1');
        expect(fromDb.html).toContain('ord_1');
      }
    });
  }

  it('order-confirmation DB render matches legacy subject and key content', async () => {
    const seed = EMAIL_TEMPLATE_SEED_DEFAULTS.find((t) => t.key === 'order-confirmation')!;
    vi.mocked(prisma.emailTemplate.findUnique).mockResolvedValue({
      key: seed.key,
      subject: seed.subject,
      preheader: seed.preheader,
      bodyMarkdown: seed.bodyMarkdown,
      updatedAt: new Date(),
    });

    const legacy = legacyEmailRenders.orderConfirmation(orderPayload, testBrand);
    const fromDb = await renderOrderConfirmation(orderPayload, testBrand);

    expect(fromDb.subject).toBe(legacy.subject);
    expect(fromDb.html).toContain('Toy');
    expect(fromDb.html).toMatch(/CAD\s12\.34/);
    expect(fromDb.text).toContain('ord_1');
  });
});

describe('B3 — HTML injection hardening (DB-template path)', () => {
  function mockOrderConfirmationTemplate() {
    const seed = EMAIL_TEMPLATE_SEED_DEFAULTS.find((t) => t.key === 'order-confirmation')!;
    vi.mocked(prisma.emailTemplate.findUnique).mockResolvedValue({
      key: seed.key,
      subject: seed.subject,
      preheader: seed.preheader,
      bodyMarkdown: seed.bodyMarkdown,
      updatedAt: new Date(),
    });
  }

  it('escapes a malicious multi-line customer name instead of emitting live HTML', async () => {
    mockOrderConfirmationTemplate();

    const maliciousPayload: OrderConfirmationEmailPayload = {
      ...orderPayload,
      customerName: 'A\n\n<img src=x onerror=alert(1)>',
    };

    const rendered = await renderOrderConfirmation(maliciousPayload, testBrand);

    expect(rendered.html).toContain('&lt;img');
    expect(rendered.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(rendered.html).not.toMatch(/<img[\s>]/);
  });

  it('still renders line items as a real HTML list (trusted fragment unaffected)', async () => {
    mockOrderConfirmationTemplate();

    const rendered = await renderOrderConfirmation(
      { ...orderPayload, customerName: 'A\n\n<img src=x onerror=alert(1)>' },
      testBrand,
    );

    expect(rendered.html).toContain('<ul><li>');
    expect(rendered.html).toContain('Toy');
  });

  it('normal names render unescaped-looking and correctly (no false-positive escaping)', async () => {
    mockOrderConfirmationTemplate();

    const rendered = await renderOrderConfirmation(orderPayload, testBrand);

    expect(rendered.html).toContain('Hi Sam,');
    expect(rendered.text).toContain('Hi Sam,');
  });

  it('does not corrupt the plain-text body when the HTML body is neutralized', async () => {
    mockOrderConfirmationTemplate();

    const rendered = await renderOrderConfirmation(
      { ...orderPayload, customerName: "O'Brien" },
      testBrand,
    );

    // plain text keeps the literal apostrophe — no HTML-entity leakage
    expect(rendered.text).toContain("Hi O'Brien,");
    expect(rendered.text).not.toContain('&#39;');
  });

  it('formatInlineMarkdown/markdownToEmailHtml drops a javascript: link href', () => {
    const out = emailTemplateService.markdownToEmailHtml('[x](javascript:alert(1))');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('href');
    expect(out).toContain('x');
  });

  it('formatInlineMarkdown/markdownToEmailHtml drops a data: link href', () => {
    const out = emailTemplateService.markdownToEmailHtml('[x](data:text/html,<script>1</script>)');
    expect(out).not.toContain('data:');
    expect(out).not.toContain('href');
  });

  it('formatInlineMarkdown/markdownToEmailHtml keeps http(s) and mailto links', () => {
    const out = emailTemplateService.markdownToEmailHtml(
      '[Shop now](https://example.com/products)\n\n[Email us](mailto:hi@example.com)',
    );
    expect(out).toContain('href="https://example.com/products"');
    expect(out).toContain('href="mailto:hi@example.com"');
  });

  it('substituteTemplateVariables(forHtml) neutralizes blank-line breakout without touching text mode', () => {
    const template = '{{greeting}}\n\nBody.';
    const vars = { greeting: 'Hi A\n\n<img src=x onerror=alert(1)>,' };

    const htmlPass = emailTemplateService.substituteTemplateVariables(template, vars, {
      forHtml: true,
    });
    // still exactly two blocks once markdownToEmailHtml splits on blank lines —
    // the malicious value can no longer fabricate a third block
    expect(htmlPass.split(/\n\n+/)).toHaveLength(2);

    const textPass = emailTemplateService.substituteTemplateVariables(template, vars);
    expect(textPass).toContain('Hi A\n\n<img src=x onerror=alert(1)>,');
  });

  it('substituteTemplateVariables(forHtml) leaves RAW_HTML_VARS (lineItems) untouched', () => {
    const value = '<ul><li>Toy</li></ul>';
    const out = emailTemplateService.substituteTemplateVariables(
      '{{lineItems}}',
      { lineItems: value },
      { forHtml: true },
    );
    expect(out).toBe(value);
  });
});
