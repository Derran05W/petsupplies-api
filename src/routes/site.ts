import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import * as siteSettingsService from '../services/siteSettingsService.js';
import * as featuredProductService from '../services/featuredProductService.js';
import * as navService from '../services/navService.js';
import * as categoryStripService from '../services/categoryStripService.js';
import * as staticPageService from '../services/staticPageService.js';

const router = new Hono();

router.get('/settings', async (c) => {
  const settings = await siteSettingsService.getSiteSettingsPublic();
  return c.json(settings);
});

router.get('/featured-products', async (c) => {
  const products = await featuredProductService.listFeaturedProducts();
  return c.json(products);
});

router.get('/nav', async (c) => {
  const nav = await navService.getSiteNav();
  return c.json(nav);
});

router.get('/category-strip', async (c) => {
  const items = await categoryStripService.listCategoryStrip();
  return c.json(items);
});

router.get('/pages/:slug', async (c) => {
  const slug = c.req.param('slug');
  try {
    const page = await staticPageService.getPublishedStaticPage(slug);
    if (!page) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json(page);
  } catch (e) {
    if (e instanceof HTTPException && e.status === 400) {
      return c.json({ error: 'Not found' }, 404);
    }
    throw e;
  }
});

export { router as siteRouter };
