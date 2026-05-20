import type { UserRole } from '@prisma/client';

export type Variables = {
  userId: string;
  /** True when JWT `app_metadata.role` === `ADMIN`. Always set by `auth`. */
  jwtAppAdmin: boolean;
  user?: {
    id: string;
    role: UserRole;
    email: string;
  };
};
