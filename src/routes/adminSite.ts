import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Variables } from '../types/hono.js';
import * as siteSettingsService from '../services/siteSettingsService.js';
import * as storageService from '../services/storageService.js';
import * as featuredProductService from '../services/featuredProductService.js';
import * as navService from '../services/navService.js';
import * as categoryStripService from '../services/categoryStripService.js';
import { siteAssetUploadUrlSchema, siteSettingsPatchSchema } from '../schemas/siteSettings.js';
import {
  replaceCategoryStripSchema,
  replaceFeaturedProductsSchema,
  replaceFooterNavSchema,
  replaceHeaderNavSchema,
} from '../schemas/siteContent.js';
import { staticPageUpsertSchema } from '../schemas/staticPage.js';
import { emailTemplateUpsertSchema } from '../schemas/emailTemplate.js';
import * as staticPageService from '../services/staticPageService.js';
import * as emailTemplateService from '../services/emailTemplateService.js';

const router = new Hono<{ Variables: Variables }>();

router.patch('/settings', zValidator('json', siteSettingsPatchSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const updated = await siteSettingsService.updateSiteSettings(body, userId);
  return c.json(updated);
});

router.post('/assets/upload-url', zValidator('json', siteAssetUploadUrlSchema), async (c) => {
  const body = c.req.valid('json');
  const result = await storageService.createSiteAssetUploadUrl(body);
  return c.json(result, 201);
});

router.put('/featured-products', zValidator('json', replaceFeaturedProductsSchema), async (c) => {
  const body = c.req.valid('json');
  const products = await featuredProductService.replaceFeaturedProducts(body.productIds);
  return c.json(products);
});

router.put('/nav/header', zValidator('json', replaceHeaderNavSchema), async (c) => {
  const body = c.req.valid('json');
  const nav = await navService.replaceHeaderNav(body);
  return c.json(nav);
});

router.put('/nav/footer', zValidator('json', replaceFooterNavSchema), async (c) => {
  const body = c.req.valid('json');
  const nav = await navService.replaceFooterNav(body);
  return c.json(nav);
});

router.put('/category-strip', zValidator('json', replaceCategoryStripSchema), async (c) => {
  const body = c.req.valid('json');
  const items = await categoryStripService.replaceCategoryStrip(body);
  return c.json(items);
});

router.get('/pages', async (c) => {
  const pages = await staticPageService.listAdminStaticPages();
  return c.json({ pages });
});

router.put('/pages/:slug', zValidator('json', staticPageUpsertSchema), async (c) => {
  const slug = c.req.param('slug');
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const page = await staticPageService.upsertStaticPage(slug, body, userId);
  return c.json(page);
});

router.get('/email-templates', async (c) => {
  const templates = await emailTemplateService.listAdminEmailTemplates();
  return c.json({ templates });
});

router.get('/email-templates/:key', async (c) => {
  const key = c.req.param('key');
  const template = await emailTemplateService.getAdminEmailTemplate(key);
  return c.json(template);
});

router.put('/email-templates/:key', zValidator('json', emailTemplateUpsertSchema), async (c) => {
  const key = c.req.param('key');
  const body = c.req.valid('json');
  const template = await emailTemplateService.upsertEmailTemplate(key, body);
  return c.json(template);
});

export { router as adminSiteRouter };
