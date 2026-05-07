import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    pet: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as petService from '../../src/services/petService.js';

const petRow = {
  id: 'caaaaaaaaaaaaaaaaaaaaaaa',
  userId: 'user-1',
  name: 'Mittens',
  species: 'CAT' as const,
  breed: null as string | null,
  birthDate: null as Date | null,
  weightGrams: null as number | null,
  dietaryNotes: null as string | null,
  profilePhotoUrl: null as string | null,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('petService.createPet', () => {
  it('createPet returns 400 PETS_LIMIT_REACHED when user already has 50 pets', async () => {
    vi.mocked(prisma.pet.count).mockResolvedValue(50);

    await expect(
      petService.createPet('user-1', { name: 'a', species: 'DOG' }),
    ).rejects.toMatchObject({ status: 400, message: 'PETS_LIMIT_REACHED' });
  });

  it('createPet checks capacity before insert', async () => {
    vi.mocked(prisma.pet.count).mockResolvedValue(50);

    await expect(petService.createPet('user-1', { name: 'a', species: 'DOG' })).rejects.toThrow(
      HTTPException,
    );
    expect(prisma.pet.count).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(prisma.pet.create).not.toHaveBeenCalled();
  });

  it('createPet passes normalized input through to prisma.pet.create', async () => {
    vi.mocked(prisma.pet.count).mockResolvedValue(0);
    vi.mocked(prisma.pet.create).mockResolvedValue(petRow as never);

    await petService.createPet('user-1', {
      name: 'Mittens',
      species: 'CAT',
      birthDate: '2022-05-07T15:30:00.000Z',
    });

    expect(prisma.pet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        name: 'Mittens',
        species: 'CAT',
        birthDate: new Date('2022-05-07T00:00:00.000Z'),
      }),
      select: petService.petSelect,
    });
  });

  it('createPet logs userId, petId, and op=create only', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.mocked(prisma.pet.count).mockResolvedValue(0);
    vi.mocked(prisma.pet.create).mockResolvedValue(petRow as never);

    await petService.createPet('user-1', { name: 'Mittens', species: 'CAT' });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(payload).toEqual({
      userId: 'user-1',
      petId: 'caaaaaaaaaaaaaaaaaaaaaaa',
      op: 'create',
    });
  });

  it('createPet normalizes birthDate to midnight UTC', async () => {
    vi.mocked(prisma.pet.count).mockResolvedValue(0);
    vi.mocked(prisma.pet.create).mockResolvedValue(petRow as never);

    await petService.createPet('user-1', {
      name: 'x',
      species: 'OTHER',
      birthDate: new Date(Date.UTC(2020, 5, 15, 22, 0, 0)),
    });

    const call = vi.mocked(prisma.pet.create).mock.calls[0][0] as {
      data: { birthDate?: Date };
    };
    expect(call.data.birthDate).toEqual(new Date(Date.UTC(2020, 5, 15)));
  });
});

describe('petService.getPet', () => {
  it('getPet uses findFirst scoped by id and userId', async () => {
    vi.mocked(prisma.pet.findFirst).mockResolvedValue(petRow as never);

    await petService.getPet('user-1', 'caaaaaaaaaaaaaaaaaaaaaaa');

    expect(prisma.pet.findFirst).toHaveBeenCalledWith({
      where: { id: 'caaaaaaaaaaaaaaaaaaaaaaa', userId: 'user-1' },
      select: petService.petSelect,
    });
  });

  it('getPet returns null when no owned pet exists', async () => {
    vi.mocked(prisma.pet.findFirst).mockResolvedValue(null);

    const result = await petService.getPet('user-1', 'cbbbbbbbbbbbbbbbbbbbbbbb');
    expect(result).toBeNull();
  });
});

describe('petService.listPets', () => {
  it('listPets returns default page=1 limit=20 sorted by createdAt asc', async () => {
    vi.mocked(prisma.pet.findMany).mockResolvedValue([petRow] as never);
    vi.mocked(prisma.pet.count).mockResolvedValue(1);

    const result = await petService.listPets('user-1', 1, 20);

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(prisma.pet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'asc' },
        skip: 0,
        take: 20,
      }),
    );
  });

  it('listPets clamps limit to 100', async () => {
    vi.mocked(prisma.pet.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.pet.count).mockResolvedValue(0);

    await petService.listPets('user-1', 1, 500);

    expect(prisma.pet.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('listPets scopes findMany and count by userId', async () => {
    vi.mocked(prisma.pet.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.pet.count).mockResolvedValue(0);

    await petService.listPets('user-b', 2, 10);

    expect(prisma.pet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-b' } }),
    );
    expect(prisma.pet.count).toHaveBeenCalledWith({ where: { userId: 'user-b' } });
  });

  it('listPets calculates totalPages from total and limit', async () => {
    vi.mocked(prisma.pet.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.pet.count).mockResolvedValue(25);

    const result = await petService.listPets('user-1', 1, 10);
    expect(result.totalPages).toBe(3);
  });
});

describe('petService.updatePet', () => {
  it('updatePet throws 400 EMPTY_PATCH on no fields', async () => {
    await expect(
      petService.updatePet('user-1', 'caaaaaaaaaaaaaaaaaaaaaaa', {}),
    ).rejects.toMatchObject({
      status: 400,
      message: 'EMPTY_PATCH',
    });
  });

  it('updatePet uses updateMany scoped by id and userId', async () => {
    vi.mocked(prisma.pet.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.pet.findFirst).mockResolvedValue({ ...petRow, name: 'New' } as never);

    await petService.updatePet('user-1', 'caaaaaaaaaaaaaaaaaaaaaaa', { name: 'New' });

    expect(prisma.pet.updateMany).toHaveBeenCalledWith({
      where: { id: 'caaaaaaaaaaaaaaaaaaaaaaa', userId: 'user-1' },
      data: { name: 'New' },
    });
  });

  it('updatePet returns null when updateMany count=0', async () => {
    vi.mocked(prisma.pet.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await petService.updatePet('user-1', 'caaaaaaaaaaaaaaaaaaaaaaa', {
      name: 'Nope',
    });
    expect(result).toBeNull();
    expect(prisma.pet.findFirst).not.toHaveBeenCalled();
  });

  it('updatePet fetches and returns the updated owned pet after count=1', async () => {
    vi.mocked(prisma.pet.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.pet.findFirst).mockResolvedValue({ ...petRow, name: 'Updated' } as never);
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await petService.updatePet('user-1', 'caaaaaaaaaaaaaaaaaaaaaaa', {
      name: 'Updated',
    });

    expect(result?.name).toBe('Updated');
    expect(prisma.pet.findFirst).toHaveBeenCalledWith({
      where: { id: 'caaaaaaaaaaaaaaaaaaaaaaa', userId: 'user-1' },
      select: petService.petSelect,
    });
  });

  it('updatePet normalizes birthDate to midnight UTC', async () => {
    vi.mocked(prisma.pet.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.pet.findFirst).mockResolvedValue(petRow as never);
    vi.spyOn(console, 'info').mockImplementation(() => {});

    await petService.updatePet('user-1', 'caaaaaaaaaaaaaaaaaaaaaaa', {
      birthDate: new Date(Date.UTC(2019, 11, 31, 20, 0, 0)),
    });

    expect(prisma.pet.updateMany).toHaveBeenCalledWith({
      where: { id: 'caaaaaaaaaaaaaaaaaaaaaaa', userId: 'user-1' },
      data: { birthDate: new Date(Date.UTC(2019, 11, 31)) },
    });
  });

  it('updatePet logs userId, petId, and op=update only after success', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.mocked(prisma.pet.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.pet.findFirst).mockResolvedValue(petRow as never);

    await petService.updatePet('user-1', 'caaaaaaaaaaaaaaaaaaaaaaa', { species: 'DOG' });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(payload).toEqual({
      userId: 'user-1',
      petId: 'caaaaaaaaaaaaaaaaaaaaaaa',
      op: 'update',
    });
  });
});

describe('petService.deletePet', () => {
  it('deletePet uses deleteMany scoped by id and userId', async () => {
    vi.mocked(prisma.pet.deleteMany).mockResolvedValue({ count: 1 });
    vi.spyOn(console, 'info').mockImplementation(() => {});

    await petService.deletePet('user-1', 'caaaaaaaaaaaaaaaaaaaaaaa');

    expect(prisma.pet.deleteMany).toHaveBeenCalledWith({
      where: { id: 'caaaaaaaaaaaaaaaaaaaaaaa', userId: 'user-1' },
    });
  });

  it('deletePet returns true when deleteMany count=1', async () => {
    vi.mocked(prisma.pet.deleteMany).mockResolvedValue({ count: 1 });
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const ok = await petService.deletePet('user-1', 'caaaaaaaaaaaaaaaaaaaaaaa');
    expect(ok).toBe(true);
  });

  it('deletePet returns false when deleteMany count=0', async () => {
    vi.mocked(prisma.pet.deleteMany).mockResolvedValue({ count: 0 });
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const ok = await petService.deletePet('user-1', 'cbbbbbbbbbbbbbbbbbbbbbbb');
    expect(ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('deletePet logs userId, petId, and op=delete only after success', async () => {
    vi.mocked(prisma.pet.deleteMany).mockResolvedValue({ count: 1 });
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await petService.deletePet('user-1', 'caaaaaaaaaaaaaaaaaaaaaaa');

    const payload = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(payload).toEqual({
      userId: 'user-1',
      petId: 'caaaaaaaaaaaaaaaaaaaaaaa',
      op: 'delete',
    });
  });
});
