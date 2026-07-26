import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../../src/services/userService.js', () => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import * as userService from '../../src/services/userService.js';
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

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'CUSTOMER',
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /users/me', () => {
  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/users/me');
    expect(res.status).toBe(401);
  });

  it('forwards userId to userService.getUser and returns profile', async () => {
    vi.mocked(userService.getUser).mockResolvedValue(mockUser as never);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(userService.getUser).toHaveBeenCalledWith('user-1');
    const body = await res.json();
    expect(body.email).toBe('test@example.com');
  });
});

describe('PATCH /users/me', () => {
  it('returns 401 without Authorization header', async () => {
    const app = createApp();
    const res = await app.request('/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    });
    expect(res.status).toBe(401);
  });

  it('forwards name to userService.updateUser', async () => {
    vi.mocked(userService.updateUser).mockResolvedValue({ ...mockUser, name: 'New Name' } as never);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'New Name' }),
    });

    expect(res.status).toBe(200);
    expect(userService.updateUser).toHaveBeenCalledWith('user-1', { name: 'New Name' });
  });

  it('rejects name longer than 100 characters', async () => {
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'x'.repeat(101) }),
    });

    expect(res.status).toBe(400);
    expect(userService.updateUser).not.toHaveBeenCalled();
  });

  it('accepts null name to clear it', async () => {
    vi.mocked(userService.updateUser).mockResolvedValue({ ...mockUser, name: null } as never);
    const token = await signToken('user-1');
    const app = createApp();
    const res = await app.request('/users/me', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: null }),
    });

    expect(res.status).toBe(200);
    expect(userService.updateUser).toHaveBeenCalledWith('user-1', { name: null });
  });
});
