import type { PetSpecies, Prisma } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';

export interface CreatePetInput {
  name: string;
  species: PetSpecies;
  breed?: string | null;
  birthDate?: Date | string | null;
  weightGrams?: number | null;
  dietaryNotes?: string | null;
  profilePhotoUrl?: string | null;
}

export interface UpdatePetInput {
  name?: string;
  species?: PetSpecies;
  breed?: string | null;
  birthDate?: Date | string | null;
  weightGrams?: number | null;
  dietaryNotes?: string | null;
  profilePhotoUrl?: string | null;
}

export interface PaginatedPets {
  data: PetPublic[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const MAX_PETS_PER_USER = 50;

export const petSelect = {
  id: true,
  userId: true,
  name: true,
  species: true,
  breed: true,
  birthDate: true,
  weightGrams: true,
  dietaryNotes: true,
  profilePhotoUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type PetPublic = Prisma.PetGetPayload<{ select: typeof petSelect }>;

function coerceDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeBirthDateUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function logPetOp(payload: { userId: string; petId: string; op: 'create' | 'update' | 'delete' }) {
  console.info(JSON.stringify(payload));
}

const UPDATABLE_KEYS: (keyof UpdatePetInput)[] = [
  'name',
  'species',
  'breed',
  'birthDate',
  'weightGrams',
  'dietaryNotes',
  'profilePhotoUrl',
];

export async function listPets(
  userId: string,
  page: number,
  limit: number,
): Promise<PaginatedPets> {
  const safePage = Math.max(1, page <= 0 ? 1 : page);
  const rawLimit = limit <= 0 ? DEFAULT_LIMIT : limit;
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));
  const skip = (safePage - 1) * safeLimit;

  const [data, total] = await Promise.all([
    prisma.pet.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      skip,
      take: safeLimit,
      select: petSelect,
    }),
    prisma.pet.count({ where: { userId } }),
  ]);

  return {
    data,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 0,
  };
}

export async function getPet(userId: string, petId: string): Promise<PetPublic | null> {
  return prisma.pet.findFirst({
    where: { id: petId, userId },
    select: petSelect,
  });
}

export async function createPet(userId: string, input: CreatePetInput): Promise<PetPublic> {
  const currentCount = await prisma.pet.count({ where: { userId } });
  if (currentCount >= MAX_PETS_PER_USER) {
    throw new HTTPException(400, { message: 'PETS_LIMIT_REACHED' });
  }

  const data: Prisma.PetUncheckedCreateInput = {
    userId,
    name: input.name,
    species: input.species,
  };

  if (input.breed !== undefined) {
    data.breed = input.breed;
  }
  if (input.birthDate !== undefined) {
    data.birthDate =
      input.birthDate === null ? null : normalizeBirthDateUTC(coerceDate(input.birthDate));
  }
  if (input.weightGrams !== undefined) {
    data.weightGrams = input.weightGrams;
  }
  if (input.dietaryNotes !== undefined) {
    data.dietaryNotes = input.dietaryNotes;
  }
  if (input.profilePhotoUrl !== undefined) {
    data.profilePhotoUrl = input.profilePhotoUrl;
  }

  const created = await prisma.pet.create({
    data,
    select: petSelect,
  });

  logPetOp({ userId, petId: created.id, op: 'create' });
  return created;
}

export async function updatePet(
  userId: string,
  petId: string,
  input: UpdatePetInput,
): Promise<PetPublic | null> {
  const touched = UPDATABLE_KEYS.filter((k) => input[k] !== undefined);
  if (touched.length === 0) {
    throw new HTTPException(400, { message: 'EMPTY_PATCH' });
  }

  const data: Prisma.PetUpdateManyMutationInput = {};

  if (input.name !== undefined) {
    data.name = input.name;
  }
  if (input.species !== undefined) {
    data.species = input.species;
  }
  if (input.breed !== undefined) {
    data.breed = input.breed;
  }
  if (input.birthDate !== undefined) {
    data.birthDate =
      input.birthDate === null ? null : normalizeBirthDateUTC(coerceDate(input.birthDate));
  }
  if (input.weightGrams !== undefined) {
    data.weightGrams = input.weightGrams;
  }
  if (input.dietaryNotes !== undefined) {
    data.dietaryNotes = input.dietaryNotes;
  }
  if (input.profilePhotoUrl !== undefined) {
    data.profilePhotoUrl = input.profilePhotoUrl;
  }

  const result = await prisma.pet.updateMany({
    where: { id: petId, userId },
    data,
  });

  if (result.count === 0) {
    return null;
  }

  logPetOp({ userId, petId, op: 'update' });

  return prisma.pet.findFirst({
    where: { id: petId, userId },
    select: petSelect,
  });
}

export async function deletePet(userId: string, petId: string): Promise<boolean> {
  const result = await prisma.pet.deleteMany({
    where: { id: petId, userId },
  });

  if (result.count > 0) {
    logPetOp({ userId, petId, op: 'delete' });
    return true;
  }
  return false;
}
