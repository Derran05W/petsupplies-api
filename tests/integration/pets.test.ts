import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/services/petService.js', () => ({
  MAX_LIMIT: 100,
  DEFAULT_LIMIT: 20,
  MAX_PETS_PER_USER: 50,
  petSelect: {},
  listPets: vi.fn(),
  getPet: vi.fn(),
  createPet: vi.fn(),
  updatePet: vi.fn(),
  deletePet: vi.fn(),
}));

import * as petService from '../../src/services/petService.js';
import { createApp } from '../../src/app.js';

const SECRET = 'test-jwt-secret-32chars-padding!!';
process.env.SUPABASE_JWT_SECRET = SECRET;

async function signToken(sub: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .sign(new TextEncoder().encode(SECRET));
}

const SAMPLE_CUID = `c${'a'.repeat(24)}`;

const samplePet = {
  id: SAMPLE_CUID,
  userId: 'user-1',
  name: 'Mittens',
  species: 'CAT' as const,
  breed: null as string | null,
  birthDate: new Date('2022-05-07T00:00:00.000Z'),
  weightGrams: 4500,
  dietaryNotes: null as string | null,
  profilePhotoUrl: 'https://cdn.example.com/p.jpg' as string | null,
  createdAt: new Date('2026-05-07T01:00:00.000Z'),
  updatedAt: new Date('2026-05-07T01:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /users/me/pets', () => {
  const envelope = {
    data: [samplePet],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };

  it('GET /users/me/pets requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request('/users/me/pets');
    expect(res.status).toBe(401);
  });

  it('GET /users/me/pets forwards userId, default pagination, and limit=20', async () => {
    vi.mocked(petService.listPets).mockResolvedValue(envelope);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(petService.listPets).toHaveBeenCalledWith('user-1', 1, 20);
  });

  it('GET /users/me/pets accepts page and limit', async () => {
    vi.mocked(petService.listPets).mockResolvedValue(envelope);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets?page=3&limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(petService.listPets).toHaveBeenCalledWith('user-1', 3, 50);
  });

  it('GET /users/me/pets rejects invalid page', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets?page=0', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    expect(petService.listPets).not.toHaveBeenCalled();
  });

  it('GET /users/me/pets rejects invalid limit above 100', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets?limit=101', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    expect(petService.listPets).not.toHaveBeenCalled();
  });

  it('GET /users/me/pets returns paginated envelope', async () => {
    vi.mocked(petService.listPets).mockResolvedValue(envelope);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof envelope;
    expect(body.totalPages).toBe(1);
    expect(body.data).toHaveLength(1);
  });
});

describe('GET /users/me/pets/:id', () => {
  it('GET /users/me/pets/:id requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`);
    expect(res.status).toBe(401);
  });

  it('GET /users/me/pets/:id returns a pet when owned', async () => {
    vi.mocked(petService.getPet).mockResolvedValue(samplePet);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(petService.getPet).toHaveBeenCalledWith('user-1', SAMPLE_CUID);
  });

  it('GET /users/me/pets/:id returns 404 PET_NOT_FOUND when missing', async () => {
    vi.mocked(petService.getPet).mockResolvedValue(null);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PET_NOT_FOUND');
  });

  it('GET /users/me/pets/:id returns 404 PET_NOT_FOUND when not-owned, not 403', async () => {
    vi.mocked(petService.getPet).mockResolvedValue(null);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/pets/${`c${'z'.repeat(24)}`}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it('GET /users/me/pets/:id returns 400 for malformed pet id', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets/not-a-cuid', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    expect(petService.getPet).not.toHaveBeenCalled();
  });
});

describe('POST /users/me/pets', () => {
  const validBody = {
    name: 'Mittens',
    species: 'CAT',
    birthDate: '2022-05-07T00:00:00.000Z',
    weightGrams: 4500,
    profilePhotoUrl: 'https://cdn.example.com/p.jpg',
  };

  it('POST /users/me/pets requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
  });

  it('POST /users/me/pets rejects name longer than 50 characters', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...validBody, name: 'x'.repeat(51) }),
    });
    expect(res.status).toBe(400);
    expect(petService.createPet).not.toHaveBeenCalled();
  });

  it('POST /users/me/pets rejects invalid species enum values', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'a', species: 'ELEPHANT' }),
    });
    expect(res.status).toBe(400);
    expect(petService.createPet).not.toHaveBeenCalled();
  });

  it('POST /users/me/pets rejects breed longer than 100 characters', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'a', species: 'DOG', breed: 'b'.repeat(101) }),
    });
    expect(res.status).toBe(400);
    expect(petService.createPet).not.toHaveBeenCalled();
  });

  it('POST /users/me/pets rejects weightGrams below 1', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'a', species: 'DOG', weightGrams: 0 }),
    });
    expect(res.status).toBe(400);
    expect(petService.createPet).not.toHaveBeenCalled();
  });

  it('POST /users/me/pets rejects weightGrams above 1000000', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'a', species: 'DOG', weightGrams: 1_000_001 }),
    });
    expect(res.status).toBe(400);
    expect(petService.createPet).not.toHaveBeenCalled();
  });

  it('POST /users/me/pets rejects dietaryNotes longer than 1000 characters', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'a', species: 'DOG', dietaryNotes: 'n'.repeat(1001) }),
    });
    expect(res.status).toBe(400);
    expect(petService.createPet).not.toHaveBeenCalled();
  });

  it('POST /users/me/pets rejects profilePhotoUrl longer than 500 characters', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const longUrl = `https://example.com/${'x'.repeat(500)}`;
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'a', species: 'DOG', profilePhotoUrl: longUrl }),
    });
    expect(res.status).toBe(400);
    expect(petService.createPet).not.toHaveBeenCalled();
  });

  it('POST /users/me/pets rejects non-url profilePhotoUrl', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'a', species: 'DOG', profilePhotoUrl: 'not a url' }),
    });
    expect(res.status).toBe(400);
    expect(petService.createPet).not.toHaveBeenCalled();
  });

  it('POST /users/me/pets rejects non-https profilePhotoUrl', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'a',
        species: 'DOG',
        profilePhotoUrl: 'http://insecure.example/x',
      }),
    });
    expect(res.status).toBe(400);
    expect(petService.createPet).not.toHaveBeenCalled();
  });

  it('POST /users/me/pets validates birthDate range and format', async () => {
    const token = await signToken('user-1');
    const app = createApp();

    const tooEarly = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'a',
        species: 'DOG',
        birthDate: '1899-12-31T00:00:00.000Z',
      }),
    });
    expect(tooEarly.status).toBe(400);

    const tooLate = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'a',
        species: 'DOG',
        birthDate: '2100-01-01T00:00:00.000Z',
      }),
    });
    expect(tooLate.status).toBe(400);

    const invalid = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'a',
        species: 'DOG',
        birthDate: 'not-a-date',
      }),
    });
    expect(invalid.status).toBe(400);
    expect(petService.createPet).not.toHaveBeenCalled();
  });

  it('POST /users/me/pets returns 201 on happy path', async () => {
    vi.mocked(petService.createPet).mockResolvedValue(samplePet);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    expect(petService.createPet).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        name: 'Mittens',
        species: 'CAT',
        weightGrams: 4500,
        profilePhotoUrl: 'https://cdn.example.com/p.jpg',
        birthDate: expect.any(Date),
      }),
    );
  });

  it('POST /users/me/pets returns 400 PETS_LIMIT_REACHED at cap', async () => {
    vi.mocked(petService.createPet).mockRejectedValue(
      new HTTPException(400, { message: 'PETS_LIMIT_REACHED' }),
    );
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'a', species: 'DOG' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PETS_LIMIT_REACHED');
  });
});

describe('PATCH /users/me/pets/:id', () => {
  it('PATCH /users/me/pets/:id requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('PATCH /users/me/pets/:id forwards valid partial update', async () => {
    vi.mocked(petService.updatePet).mockResolvedValue({ ...samplePet, name: 'Patch' });
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Patch' }),
    });
    expect(res.status).toBe(200);
    expect(petService.updatePet).toHaveBeenCalledWith('user-1', SAMPLE_CUID, { name: 'Patch' });
  });

  it('PATCH /users/me/pets/:id returns 404 PET_NOT_FOUND when not-owned', async () => {
    vi.mocked(petService.updatePet).mockResolvedValue(null);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PET_NOT_FOUND');
  });

  it('PATCH /users/me/pets/:id returns 400 EMPTY_PATCH for empty body', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: false; error: { message: string } };
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('EMPTY_PATCH');
    expect(petService.updatePet).not.toHaveBeenCalled();
  });

  it('PATCH /users/me/pets/:id applies the same validation surface as POST for provided fields', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ weightGrams: 0 }),
    });
    expect(res.status).toBe(400);
    expect(petService.updatePet).not.toHaveBeenCalled();
  });

  it('PATCH /users/me/pets/:id returns 400 for malformed pet id', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets/invalid-id', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(400);
    expect(petService.updatePet).not.toHaveBeenCalled();
  });
});

describe('DELETE /users/me/pets/:id', () => {
  it('DELETE /users/me/pets/:id requires auth (401)', async () => {
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('DELETE /users/me/pets/:id returns 204 on owned pet', async () => {
    vi.mocked(petService.deletePet).mockResolvedValue(true);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
    expect(petService.deletePet).toHaveBeenCalledWith('user-1', SAMPLE_CUID);
  });

  it('DELETE /users/me/pets/:id returns 404 PET_NOT_FOUND when missing', async () => {
    vi.mocked(petService.deletePet).mockResolvedValue(false);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/pets/${SAMPLE_CUID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PET_NOT_FOUND');
  });

  it('DELETE /users/me/pets/:id returns 404 PET_NOT_FOUND when not-owned', async () => {
    vi.mocked(petService.deletePet).mockResolvedValue(false);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request(`/users/me/pets/${`c${'y'.repeat(24)}`}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /users/me/pets/:id returns 400 for malformed pet id', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/pets/bad', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    expect(petService.deletePet).not.toHaveBeenCalled();
  });
});
