import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Variables } from '../types/hono.js';
import * as adminProductService from '../services/adminProductService.js';
import * as storageService from '../services/storageService.js';
import {
  listAdminProductsQuerySchema,
  productIdParamSchema,
  imageIdParamSchema,
  createProductSchema,
  updateProductSchema,
  addImageSchema,
  updateImageSchema,
  reorderSchema,
  uploadUrlRequestSchema,
} from '../schemas/adminProducts.js';

const router = new Hono<{ Variables: Variables }>();

// ─── Upload URL (no product ID required yet) ──────────────────────────────────

router.post('/images/upload-url', zValidator('json', uploadUrlRequestSchema), async (c) => {
  const body = c.req.valid('json');
  const result = await storageService.createProductImageUploadUrl(body);
  return c.json(result, 201);
});

// ─── Product list & create ────────────────────────────────────────────────────

router.get('/', zValidator('query', listAdminProductsQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const result = await adminProductService.listAdminProducts({
    page: q.page,
    limit: q.limit,
    q: q.q,
    category: q.category,
    active: q.active,
  });
  return c.json(result);
});

router.post('/', zValidator('json', createProductSchema), async (c) => {
  const body = c.req.valid('json');
  const product = await adminProductService.createProduct(body);
  return c.json(product, 201);
});

// ─── Single product ───────────────────────────────────────────────────────────

router.get('/:id', zValidator('param', productIdParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const product = await adminProductService.getAdminProductById(id);
  return c.json(product);
});

router.patch(
  '/:id',
  zValidator('param', productIdParamSchema),
  zValidator('json', updateProductSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const product = await adminProductService.updateProduct(id, body);
    return c.json(product);
  },
);

router.delete('/:id', zValidator('param', productIdParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const result = await adminProductService.deleteProduct(id);
  return c.json(result);
});

// ─── Product images ───────────────────────────────────────────────────────────

router.post(
  '/:id/images',
  zValidator('param', productIdParamSchema),
  zValidator('json', addImageSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const image = await adminProductService.addProductImage(id, body);
    return c.json(image, 201);
  },
);

router.patch(
  '/:id/images/reorder',
  zValidator('param', productIdParamSchema),
  zValidator('json', reorderSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { items } = c.req.valid('json');
    await adminProductService.reorderProductImages(id, items);
    return c.json({ ok: true });
  },
);

router.patch(
  '/:id/images/:imageId',
  zValidator('param', imageIdParamSchema),
  zValidator('json', updateImageSchema),
  async (c) => {
    const { imageId } = c.req.valid('param');
    const body = c.req.valid('json');
    const image = await adminProductService.updateProductImage(imageId, body);
    return c.json(image);
  },
);

router.delete('/:id/images/:imageId', zValidator('param', imageIdParamSchema), async (c) => {
  const { imageId } = c.req.valid('param');
  await adminProductService.deleteProductImage(imageId);
  return c.body(null, 204);
});

// ─── Package metadata (moved from admin.ts) ───────────────────────────────────
// NOTE: These two routes are kept in admin.ts to avoid a breaking change.
// They are intentionally NOT duplicated here.

export { router as adminProductsRouter };
