import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../../src/services/addressService.js', () => ({
  listAddresses: vi.fn(),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
  setDefaultAddress: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import * as addressService from '../../src/services/addressService.js';
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

const validAddress = {
  line1: '123 Main St',
  city: 'Toronto',
  region: 'ON',
  postalCode: 'M5V 3A8',
  country: 'CA',
};

const mockAddress = {
  id: 'addr-1',
  userId: 'user-1',
  label: null,
  ...validAddress,
  line2: null,
  isDefault: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /users/me/addresses', () => {
  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/users/me/addresses');
    expect(res.status).toBe(401);
  });

  it('forwards userId to addressService.listAddresses', async () => {
    vi.mocked(addressService.listAddresses).mockResolvedValue([mockAddress] as never);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/addresses', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(addressService.listAddresses).toHaveBeenCalledWith('user-1');
    const body = await res.json();
    expect(body).toHaveLength(1);
  });
});

describe('POST /users/me/addresses', () => {
  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/users/me/addresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validAddress),
    });
    expect(res.status).toBe(401);
  });

  it('validates Canadian address and returns 201', async () => {
    vi.mocked(addressService.createAddress).mockResolvedValue(mockAddress as never);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/addresses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validAddress),
    });

    expect(res.status).toBe(201);
    expect(addressService.createAddress).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ line1: '123 Main St', country: 'CA' }),
    );
  });

  it('rejects invalid postal code', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/addresses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...validAddress, postalCode: '12345' }),
    });

    expect(res.status).toBe(400);
    expect(addressService.createAddress).not.toHaveBeenCalled();
  });

  it('rejects non-CA country', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/addresses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...validAddress, country: 'US' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /users/me/addresses/:id', () => {
  it('rejects empty body', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/addresses/addr-1', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('rejects invalid Canadian postal code', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/addresses/addr-1', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ postalCode: 'BADCODE' }),
    });

    expect(res.status).toBe(400);
  });

  it('forwards valid partial update to addressService.updateAddress', async () => {
    vi.mocked(addressService.updateAddress).mockResolvedValue(mockAddress as never);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/addresses/addr-1', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ city: 'Vancouver' }),
    });

    expect(res.status).toBe(200);
    expect(addressService.updateAddress).toHaveBeenCalledWith('user-1', 'addr-1', {
      city: 'Vancouver',
    });
  });
});

describe('DELETE /users/me/addresses/:id', () => {
  it('returns 204 on successful delete', async () => {
    vi.mocked(addressService.deleteAddress).mockResolvedValue(undefined);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/addresses/addr-1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(204);
    expect(addressService.deleteAddress).toHaveBeenCalledWith('user-1', 'addr-1');
  });
});

describe('POST /users/me/addresses/:id/default', () => {
  it('forwards to addressService.setDefaultAddress', async () => {
    vi.mocked(addressService.setDefaultAddress).mockResolvedValue(mockAddress as never);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me/addresses/addr-1/default', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(addressService.setDefaultAddress).toHaveBeenCalledWith('user-1', 'addr-1');
  });
});
