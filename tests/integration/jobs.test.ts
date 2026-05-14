import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../../src/app.js';

vi.mock('../../src/services/jobRunner.js', () => ({
  JOB_BATCH_SIZE: 200,
  runAbandonedCartJob: vi.fn(),
  runUpcomingDeliveryJob: vi.fn(),
  runBackInStockNotificationJob: vi.fn(),
}));

import * as jobRunner from '../../src/services/jobRunner.js';

const CRON = process.env.CRON_BEARER_TOKEN!;

function wrongBearerSameLength(ok: string): string {
  const last = ok.charCodeAt(ok.length - 1);
  const swap = last === 122 ? String.fromCharCode(121) : String.fromCharCode(last + 1);
  return ok.slice(0, -1) + swap;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(jobRunner.runAbandonedCartJob).mockResolvedValue({
    scanned: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    durationMs: 2,
  });
  vi.mocked(jobRunner.runUpcomingDeliveryJob).mockResolvedValue({
    scanned: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    durationMs: 3,
  });
  vi.mocked(jobRunner.runBackInStockNotificationJob).mockResolvedValue({
    scanned: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    durationMs: 4,
  });
});

describe('POST /jobs/run/:name', () => {
  it('POST /jobs/run/abandoned-cart returns 401 when bearer is missing', async () => {
    const app = createApp();
    const res = await app.request('/jobs/run/abandoned-cart', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('POST /jobs/run/abandoned-cart returns 401 when bearer is wrong', async () => {
    const bad = wrongBearerSameLength(CRON);
    expect(bad.length).toBe(CRON.length);

    const app = createApp();
    const res = await app.request('/jobs/run/abandoned-cart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${bad}` },
    });
    expect(res.status).toBe(401);
  });

  it('POST /jobs/run/unknown returns 404 with valid bearer', async () => {
    const app = createApp();
    const res = await app.request('/jobs/run/unknown', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON}` },
    });
    expect(res.status).toBe(404);
  });

  it('POST /jobs/run/abandoned-cart returns 200 with JobResult JSON for valid bearer', async () => {
    const payload = {
      scanned: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
      durationMs: 9,
    };
    vi.mocked(jobRunner.runAbandonedCartJob).mockResolvedValue(payload);

    const app = createApp();
    const res = await app.request('/jobs/run/abandoned-cart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it('POST /jobs/run/upcoming-delivery returns 200 with JobResult JSON for valid bearer', async () => {
    const payload = {
      scanned: 2,
      sent: 1,
      failed: 1,
      skipped: 0,
      durationMs: 10,
    };
    vi.mocked(jobRunner.runUpcomingDeliveryJob).mockResolvedValue(payload);

    const app = createApp();
    const res = await app.request('/jobs/run/upcoming-delivery', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it('POST /jobs/run/back-in-stock returns 200 with JobResult JSON for valid bearer', async () => {
    const payload = {
      scanned: 3,
      sent: 2,
      failed: 0,
      skipped: 1,
      durationMs: 11,
    };
    vi.mocked(jobRunner.runBackInStockNotificationJob).mockResolvedValue(payload);

    const app = createApp();
    const res = await app.request('/jobs/run/back-in-stock', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it('POST /jobs/run/:name returns 500 if runner throws unexpectedly', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(jobRunner.runAbandonedCartJob).mockRejectedValueOnce(new Error('boom'));

    const app = createApp();
    const res = await app.request('/jobs/run/abandoned-cart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON}` },
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL_ERROR' });

    const loggedErr = JSON.stringify(errSpy.mock.calls.flat());
    expect(loggedErr).not.toContain('boom');

    errSpy.mockRestore();
  });

  it('POST /jobs/run/:name 401 body has no detail beyond error UNAUTHORIZED', async () => {
    const app = createApp();
    const res = await app.request('/jobs/run/abandoned-cart', { method: 'POST' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: 'UNAUTHORIZED' });
    expect(Object.keys(body).sort()).toEqual(['error']);
  });
});
