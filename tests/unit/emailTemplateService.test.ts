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
    expect(fromDb.html).toContain('$12.34');
    expect(fromDb.text).toContain('ord_1');
  });
});
