/**
 * db-health hosts the project-AOI liveness check. These tests are about the
 * hosting contract, not the classifier (that is unit-tested in
 * src/modules/attendance/alerts/__tests__/projectAoiStaleness.test.ts):
 * db-health is a per-minute production probe, so the passenger must never
 * change its verdict, its HTTP status, or its ability to return.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/modules/notifications/services/whatsappDelivery', () => ({
  sendWhatsAppGroup: vi.fn().mockResolvedValue(undefined),
}));

import handler from '@/pages/api/cron/db-health';
import { pool } from '@/lib/db';
import { sendWhatsAppGroup } from '@/modules/notifications/services/whatsappDelivery';
import { resetAoiAlertCooldown } from '@/modules/attendance/alerts/projectAoiStaleness';

interface Captured { status: number; body: Record<string, unknown> }

function mockRes(): { res: NextApiResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: {} };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: Record<string, unknown>) { captured.body = body; return this; },
  } as unknown as NextApiResponse;
  return { res, captured };
}

const req = { method: 'GET', headers: {}, query: {} } as unknown as NextApiRequest;

const poolQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/**
 * Routes by query text the way the real pool does. `aoiRows` of null makes the
 * AOI queries throw while the health probe keeps succeeding — the split this
 * whole file exists to verify.
 */
function stubPool(opts: { healthy?: boolean; computedAt?: string | null; rowCount?: number; aoiThrows?: boolean }) {
  poolQuery.mockImplementation(async (text: string) => {
    if (text.includes('SELECT 1 AS check')) {
      if (opts.healthy === false) throw new Error('connection refused');
      return { rows: [{ check: 1 }] };
    }
    if (opts.aoiThrows) throw new Error('relation "project_aois" does not exist');
    if (text.includes('to_regclass')) return { rows: [{ has_table: true, has_status: true }] };
    return {
      rows: [{
        row_count: opts.rowCount ?? 9,
        newest_computed_at: opts.computedAt ?? new Date().toISOString(),
        unscored_count: 0,
      }],
    };
  });
}

const THREE_DAYS_AGO = () => new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  resetAoiAlertCooldown();
});

describe('db-health hosting the project AOI liveness check', () => {
  it('reports a healthy database and a current refresh', async () => {
    stubPool({});
    const { res, captured } = mockRes();
    await handler(req, res);
    expect(captured.status).toBe(200);
    expect(captured.body.status).toBe('healthy');
    expect(captured.body.projectAoi).toMatchObject({ state: 'current', rowCount: 9 });
  });

  it('still reports database health when the AOI check throws', async () => {
    // The whole point of requirement 4. A missing table or a renamed column in
    // an attendance data-quality check must not take down a per-minute
    // production database probe, and must not page anyone about the database.
    stubPool({ aoiThrows: true });
    const { res, captured } = mockRes();
    await expect(handler(req, res)).resolves.not.toThrow();
    expect(captured.status).toBe(200);
    expect(captured.body.status).toBe('healthy');
    expect(captured.body.projectAoi).toBeNull();
    expect(sendWhatsAppGroup).not.toHaveBeenCalled();
  });

  it('does not change the HTTP status when the refresh has stopped', async () => {
    // A dead nightly cron is not a database fault. Returning 503 here would
    // make every uptime check treat it as one.
    stubPool({ computedAt: THREE_DAYS_AGO() });
    const { res, captured } = mockRes();
    await handler(req, res);
    expect(captured.status).toBe(200);
    expect(captured.body.status).toBe('healthy');
    expect(captured.body.projectAoi).toMatchObject({ state: 'not_running' });
  });

  it('alerts once for a stopped refresh, then holds its tongue', async () => {
    // The host runs every minute; the second call stands in for the next 1,439.
    stubPool({ computedAt: THREE_DAYS_AGO() });
    await handler(req, mockRes().res);
    expect(sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    const [, message] = (sendWhatsAppGroup as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toContain('NOT RUNNING');

    const second = mockRes();
    await handler(req, second.res);
    expect(sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    // Suppressed for delivery, still reported in the response body — the
    // queryable state must not go quiet just because the alert did.
    expect(second.captured.body.projectAoi).toMatchObject({ state: 'not_running' });
  });

  it('survives a WhatsApp bridge failure without failing the probe', async () => {
    stubPool({ computedAt: THREE_DAYS_AGO() });
    (sendWhatsAppGroup as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bridge down'));
    const { res, captured } = mockRes();
    await expect(handler(req, res)).resolves.not.toThrow();
    expect(captured.status).toBe(200);
    expect(captured.body.projectAoi).toMatchObject({ state: 'not_running' });
  });

  it('skips the AOI check entirely when the database itself is down', async () => {
    // "The nightly refresh looks dead" is a misleading thing to say during a
    // database outage, and the probe would only fail the same way.
    stubPool({ healthy: false });
    const { res, captured } = mockRes();
    await handler(req, res);
    expect(captured.status).toBe(503);
    expect(captured.body.status).toBe('unhealthy');
    expect(captured.body.projectAoi).toBeNull();
    // The DB alert may fire; the AOI one must not.
    for (const call of (sendWhatsAppGroup as unknown as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[1])).not.toContain('PROJECT AOI');
    }
  });
});
