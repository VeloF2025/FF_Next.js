/**
 * H&S overdue-audit reminders cron — auth, dedupe, refresh, resolve (D7)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));

import handler from '../../../../pages/api/cron/hs-audit-reminders';

const CFG = {
  id: 'cfg11111-2222-3333-4444-555555555555',
  project_id: 'p1111111-2222-3333-4444-555555555555',
  project_name: 'Mahikeng',
  next_audit_due: '2026-07-20',
  audit_frequency: 'weekly',
  days_overdue: 3,
};

function q(call: unknown[]): string {
  return (call[0] as string[]).join('$').replace(/\s+/g, ' ');
}

function run(secret?: string) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
  return { req, res };
}

describe('POST /api/cron/hs-audit-reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  it('rejects a missing/wrong cron secret', async () => {
    const { req, res } = run('wrong');
    await handler(req, res);
    expect(res._getStatusCode()).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const { req, res } = run('anything');
    await handler(req, res);
    expect(res._getStatusCode()).toBeGreaterThanOrEqual(500);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('formats driver-returned Date objects as ISO dates in descriptions', async () => {
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ');
      if (text.includes('FROM hs_project_config')) {
        // pg returns timestamptz as a JS Date, not a string
        return Promise.resolve([{ ...CFG, next_audit_due: new Date('2026-07-20T00:00:00Z') }]);
      }
      if (text.includes('SELECT id FROM action_items')) return Promise.resolve([]);
      if (text.includes('UPDATE action_items') && text.includes('RETURNING id')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const { req, res } = run('test-secret');
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const insert = sqlMock.mock.calls.find((c) => q(c).includes('INSERT INTO action_items'));
    const description = String(insert!.slice(1)[0]);
    expect(description).toContain('2026-07-20');
    expect(description).not.toMatch(/Mon Jul|Sun Jul|GMT/);
  });

  it('creates an action item for an overdue config with no open item', async () => {
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ');
      if (text.includes('FROM hs_project_config')) return Promise.resolve([CFG]);
      if (text.includes('SELECT id FROM action_items')) return Promise.resolve([]);
      if (text.includes('UPDATE action_items') && text.includes('RETURNING id')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const { req, res } = run('test-secret');
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const insert = sqlMock.mock.calls.find((c) => q(c).includes('INSERT INTO action_items'));
    expect(insert).toBeDefined();
    expect(insert!.slice(1)).toContain(CFG.id);
    const body = JSON.parse(res._getData());
    expect(body.data.created).toBe(1);
    expect(body.data.refreshed).toBe(0);
  });

  it('refreshes instead of duplicating when an open item exists (idempotent)', async () => {
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ');
      if (text.includes('FROM hs_project_config')) return Promise.resolve([CFG]);
      if (text.includes('SELECT id FROM action_items')) return Promise.resolve([{ id: 'ai-1' }]);
      if (text.includes('UPDATE action_items') && text.includes('RETURNING id')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const { req, res } = run('test-secret');
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const insert = sqlMock.mock.calls.find((c) => q(c).includes('INSERT INTO action_items'));
    expect(insert).toBeUndefined();
    const body = JSON.parse(res._getData());
    expect(body.data.created).toBe(0);
    expect(body.data.refreshed).toBe(1);
  });

  it('auto-completes open items whose config is no longer overdue', async () => {
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ');
      if (text.includes('FROM hs_project_config')) return Promise.resolve([]);
      if (text.includes('UPDATE action_items') && text.includes('RETURNING id')) {
        return Promise.resolve([{ id: 'ai-stale' }]);
      }
      return Promise.resolve([]);
    });

    const { req, res } = run('test-secret');
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.data.resolved).toBe(1);
    expect(body.data.created).toBe(0);
  });
});
