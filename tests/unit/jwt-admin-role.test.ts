import { describe, it, expect } from 'vitest';
import type { JWTPayload } from 'jose';
import {
  jwtPayloadHasAppAdminRole,
  jwtPayloadHasUserMetadataAdminRole,
} from '../../src/lib/jwt-admin-role.js';

describe('jwt-admin-role', () => {
  it('detects app_metadata ADMIN', () => {
    const payload = { app_metadata: { role: 'ADMIN' } } as JWTPayload;
    expect(jwtPayloadHasAppAdminRole(payload)).toBe(true);
    expect(jwtPayloadHasUserMetadataAdminRole(payload)).toBe(false);
  });

  it('detects user_metadata ADMIN without app_metadata', () => {
    const payload = { user_metadata: { role: 'ADMIN' } } as JWTPayload;
    expect(jwtPayloadHasAppAdminRole(payload)).toBe(false);
    expect(jwtPayloadHasUserMetadataAdminRole(payload)).toBe(true);
  });

  it('rejects non-admin', () => {
    const payload = {
      app_metadata: { role: 'USER' },
      user_metadata: {},
    } as JWTPayload;
    expect(jwtPayloadHasAppAdminRole(payload)).toBe(false);
    expect(jwtPayloadHasUserMetadataAdminRole(payload)).toBe(false);
  });
});
