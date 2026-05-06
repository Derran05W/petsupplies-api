import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/lib/prisma.js';
import * as userService from '../../src/services/userService.js';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'CUSTOMER' as const,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('userService.getUser', () => {
  it('returns the user profile', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

    const result = await userService.getUser('user-1');

    expect(result.id).toBe('user-1');
    expect(result.email).toBe('test@example.com');
    expect('role' in result).toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });

  it('throws 404 when user is missing', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(userService.getUser('ghost')).rejects.toThrow(HTTPException);
    await expect(userService.getUser('ghost')).rejects.toMatchObject({ status: 404 });
  });
});

describe('userService.updateUser', () => {
  it('updates only name and returns updated profile', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);
    vi.mocked(prisma.user.update).mockResolvedValue({ ...mockUser, name: 'New Name' } as never);

    const result = await userService.updateUser('user-1', { name: 'New Name' });

    expect(result.name).toBe('New Name');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { name: 'New Name' },
      }),
    );
  });

  it('does not allow updating role or email via data shape', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);
    vi.mocked(prisma.user.update).mockResolvedValue(mockUser as never);

    await userService.updateUser('user-1', { name: null });

    const updateCall = vi.mocked(prisma.user.update).mock.calls[0]![0];
    expect(updateCall.data).not.toHaveProperty('role');
    expect(updateCall.data).not.toHaveProperty('email');
  });

  it('throws 404 when user is missing', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(userService.updateUser('ghost', { name: 'X' })).rejects.toMatchObject({
      status: 404,
    });
  });
});
