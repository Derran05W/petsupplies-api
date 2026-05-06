import { HTTPException } from 'hono/http-exception';
import { prisma } from '../lib/prisma.js';

export interface UpdateUserInput {
  name?: string | null;
}

export async function getUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  return user;
}

export async function updateUser(userId: string, input: UpdateUserInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  return prisma.user.update({
    where: { id: userId },
    data: { name: input.name },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
}
