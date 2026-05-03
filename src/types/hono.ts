import type { UserRole } from '@prisma/client';

export type Variables = {
  userId: string;
  user?: {
    id: string;
    role: UserRole;
    email: string;
  };
};
