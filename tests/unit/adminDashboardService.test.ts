import { describe, it, expect, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';

import { resolveOverviewRange } from '../../src/services/adminDashboardService.js';

describe('adminDashboardService.resolveOverviewRange', () => {
  it('defaults to approximately 30 days when both omitted', () => {
    const { from, to } = resolveOverviewRange();
    expect(to >= from).toBe(true);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(29.9);
    expect(days).toBeLessThanOrEqual(30.1);
  });

  it('throws 400 when from is after to', () => {
    const to = new Date('2026-01-10T12:00:00.000Z');
    const from = new Date('2026-02-01T12:00:00.000Z');
    expect(() => resolveOverviewRange(from, to)).toThrow(HTTPException);
  });

  it('throws when span exceeds 366 days', () => {
    const from = new Date('2026-01-01T12:00:00.000Z');
    const to = new Date('2027-12-31T12:00:00.000Z');
    expect(() => resolveOverviewRange(from, to)).toThrow(HTTPException);
  });

  it('when only `from` is supplied, clamps `to` to now-ish window', () => {
    const from = new Date('2099-01-01T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-02-01T12:00:00.000Z'));
    try {
      const range = resolveOverviewRange(from);
      expect(range.from).toEqual(from);
      expect(range.to.getTime()).toBe(new Date('2099-02-01T12:00:00.000Z').getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it('when only `to` is supplied, backfills `from` 30 days earlier', () => {
    const to = new Date('2099-12-31T15:00:00.000Z');
    const range = resolveOverviewRange(undefined, to);
    expect(range.to.getTime()).toBe(to.getTime());
    expect(range.from.getTime()).toBe(to.getTime() - 30 * 86_400_000);
  });
});
