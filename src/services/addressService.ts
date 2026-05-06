import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';

// ── Input types ───────────────────────────────────────────────────────────────

export interface CreateAddressInput {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  isDefault?: boolean;
}

export interface UpdateAddressInput {
  label?: string;
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  isDefault?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const addressSelect = {
  id: true,
  userId: true,
  label: true,
  line1: true,
  line2: true,
  city: true,
  region: true,
  postalCode: true,
  country: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function requireOwned(userId: string, addressId: string) {
  const address = await prisma.address.findFirst({
    where: { id: addressId, userId },
    select: addressSelect,
  });
  if (!address) {
    throw new HTTPException(404, { message: 'Address not found' });
  }
  return address;
}

// ── Service functions ─────────────────────────────────────────────────────────

export async function listAddresses(userId: string) {
  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: addressSelect,
  });
}

export async function createAddress(userId: string, input: CreateAddressInput) {
  const existingCount = await prisma.address.count({ where: { userId } });
  const forceDefault = existingCount === 0;
  const makeDefault = forceDefault || input.isDefault === true;

  return prisma.$transaction(async (tx) => {
    if (makeDefault) {
      // Unset any existing defaults for this user
      await tx.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.address.create({
      data: {
        userId,
        label: input.label,
        line1: input.line1,
        line2: input.line2,
        city: input.city,
        region: input.region,
        postalCode: input.postalCode,
        country: input.country,
        isDefault: makeDefault,
      },
      select: addressSelect,
    });
  });
}

export async function updateAddress(userId: string, addressId: string, input: UpdateAddressInput) {
  const existing = await requireOwned(userId, addressId);

  // Silently ignore attempts to set isDefault: false on the current default
  const settingDefault = input.isDefault === true;
  const clearingDefault = input.isDefault === false && existing.isDefault;

  return prisma.$transaction(async (tx) => {
    if (settingDefault) {
      await tx.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.address.update({
      where: { id: addressId },
      data: {
        label: input.label,
        line1: input.line1,
        line2: input.line2,
        city: input.city,
        region: input.region,
        postalCode: input.postalCode,
        country: input.country,
        // Ignore attempts to clear the default directly — use setDefaultAddress instead
        isDefault: clearingDefault ? existing.isDefault : input.isDefault,
      },
      select: addressSelect,
    });
  });
}

export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  const existing = await requireOwned(userId, addressId);

  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id: addressId } });

    if (existing.isDefault) {
      // Auto-promote the oldest remaining address
      const oldest = await tx.address.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (oldest) {
        await tx.address.update({
          where: { id: oldest.id },
          data: { isDefault: true },
        });
      }
    }
  });
}

export async function setDefaultAddress(userId: string, addressId: string) {
  await requireOwned(userId, addressId);

  return prisma.$transaction(async (tx) => {
    await tx.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });

    return tx.address.update({
      where: { id: addressId },
      data: { isDefault: true },
      select: addressSelect,
    });
  });
}
