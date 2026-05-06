import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import * as addressService from '../services/addressService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth);

const POSTAL_CODE_CA = /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i;

const addressBaseSchema = z.object({
  label: z.string().trim().max(50).optional(),
  line1: z.string().trim().min(1),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1),
  region: z.string().trim().min(1),
  postalCode: z.string().trim().regex(POSTAL_CODE_CA, 'Invalid Canadian postal code'),
  country: z.enum(['CA']),
  isDefault: z.boolean().optional(),
});

const createAddressSchema = addressBaseSchema;

const updateAddressSchema = addressBaseSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

router.get('/', async (c) => {
  const userId = c.get('userId');
  const addresses = await addressService.listAddresses(userId);
  return c.json(addresses);
});

router.post('/', zValidator('json', createAddressSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const address = await addressService.createAddress(userId, body);
  return c.json(address, 201);
});

router.patch('/:id', zValidator('json', updateAddressSchema), async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const address = await addressService.updateAddress(userId, id, body);
  return c.json(address);
});

router.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await addressService.deleteAddress(userId, id);
  return c.body(null, 204);
});

router.post('/:id/default', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const address = await addressService.setDefaultAddress(userId, id);
  return c.json(address);
});

export { router as addressesRouter };
