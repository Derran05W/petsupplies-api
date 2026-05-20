import type { JWTPayload } from 'jose';

function readRole(
  meta: JWTPayload['app_metadata'] | JWTPayload['user_metadata'],
): string | undefined {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const role = (meta as Record<string, unknown>).role;
    if (typeof role === 'string') return role;
  }
  return undefined;
}

/** Server-controlled claim — safe for DB self-heal. */
export function jwtPayloadHasAppAdminRole(payload: JWTPayload): boolean {
  return readRole(payload.app_metadata) === 'ADMIN';
}

/**
 * Legacy read-only — do NOT use for self-heal (users can set via updateUser).
 * Web gate may still honor this until migration completes.
 */
export function jwtPayloadHasUserMetadataAdminRole(payload: JWTPayload): boolean {
  return readRole(payload.user_metadata) === 'ADMIN';
}
