import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  createPet,
  deletePet,
  getPet,
  listPets,
  updatePet,
} from '../services/petService.js';
import type { Variables } from '../types/hono.js';

const router = new Hono<{ Variables: Variables }>();

router.use('*', auth);

const BIRTH_DATE_MIN = new Date('1900-01-01T00:00:00.000Z');

const speciesSchema = z.enum([
  'DOG',
  'CAT',
  'FISH',
  'BIRD',
  'RABBIT',
  'HAMSTER',
  'GUINEA_PIG',
  'REPTILE',
  'OTHER',
] as const);

const httpsUrlSchema = z
  .string()
  .max(500)
  .superRefine((value, ctx) => {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'profilePhotoUrl must be an HTTPS URL',
        });
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid profilePhotoUrl' });
    }
  });

const birthDateSchema = z.coerce
  .date()
  .nullable()
  .optional()
  .superRefine((val, ctx) => {
    if (val === null || val === undefined) {
      return;
    }
    if (Number.isNaN(val.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid birthDate' });
      return;
    }
    const max = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (val < BIRTH_DATE_MIN) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'birthDate too early' });
    }
    if (val > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'birthDate in the future' });
    }
  });

const petBaseSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    species: speciesSchema,
    breed: z.string().trim().min(1).max(100).nullable().optional(),
    birthDate: birthDateSchema,
    weightGrams: z.number().int().min(1).max(1_000_000).nullable().optional(),
    dietaryNotes: z.string().trim().min(1).max(1000).nullable().optional(),
    profilePhotoUrl: httpsUrlSchema.nullable().optional(),
  })
  .strict();

const createPetSchema = petBaseSchema;

const updatePetSchema = petBaseSchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'EMPTY_PATCH' });

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
});

const petIdParamSchema = z.object({
  id: z.string().regex(/^c[a-z0-9]{24}$/, 'Invalid pet id'),
});

router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const q = c.req.valid('query');
  const userId = c.get('userId');
  const result = await listPets(userId, q.page ?? 1, q.limit ?? DEFAULT_LIMIT);
  return c.json(result);
});

router.get('/:id', zValidator('param', petIdParamSchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const pet = await getPet(userId, id);
  if (!pet) {
    throw new HTTPException(404, { message: 'PET_NOT_FOUND' });
  }
  return c.json(pet);
});

router.post('/', zValidator('json', createPetSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const pet = await createPet(userId, body);
  return c.json(pet, 201);
});

router.patch(
  '/:id',
  zValidator('param', petIdParamSchema),
  zValidator('json', updatePetSchema),
  async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const pet = await updatePet(userId, id, body);
    if (!pet) {
      throw new HTTPException(404, { message: 'PET_NOT_FOUND' });
    }
    return c.json(pet);
  },
);

router.delete('/:id', zValidator('param', petIdParamSchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const deleted = await deletePet(userId, id);
  if (!deleted) {
    throw new HTTPException(404, { message: 'PET_NOT_FOUND' });
  }
  return c.body(null, 204);
});

export { router as petsRouter };
