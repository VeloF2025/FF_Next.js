/**
 * Tests for GET /api/field/attendance — Rule-P-exempt field-worker attendance read.
 *
 * Key invariants under test:
 *   (a) Pending technician entries ARE returned (proves Rule-P exemption — no
 *       `account_status <> 'pending'` predicate anywhere in the query).
 *   (b) Non-field roles (e.g. 'manager') are excluded by the role IN filter.
 *   (c) hours IS NULL when clock_out_at is null (open entry).
 *
 * SQL-shape assertions verify the WHERE clause contains
 * `role IN ('technician','casual')` and does NOT contain any form of
 * `approvedAccountPredicate` or `account_status <> 'pending'`.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks before any imports ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

// ── Handler import (after mocks are hoisted) ─────────────────────────────────

import handler from '../../../../pages/api/field/attendance';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(
  query: Record<string, string> = {},
  method = 'GET'
): NextApiRequest {
  return { method, query, headers: {}, socket: {} } as unknown as NextApiRequest;
}

function makeRes() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    setHeader() {},
    getHeader() {},
  };
  return { res: res as unknown as NextApiResponse, captured };
}

/**
 * Reconstruct the SQL text from a mocked tagged-template call.
 * `sql\`…\`` passes TemplateStringsArray as calls[n][0].
 * We join the raw string parts with a placeholder to preserve shape.
 */
function capturedSql(callIndex = 0): string {
  const rawParts = mocks.sql.mock.calls[callIndex]?.[0] as TemplateStringsArray | undefined;
  if (!rawParts) throw new Error(`No sql call at index ${callIndex}`);
  return Array.from(rawParts).join('$?');
}

const FROM = '2026-06-01';
const TO   = '2026-06-07';

/** A pending technician with an open clock-in (no clock_out_at). */
const PENDING_TECH_OPEN: Record<string, unknown> = {
  entry_id:          'e-open-1',
  staff_id:          's-tech-pending',
  staff_name:        'Sipho Dlamini',
  role:              'technician',
  account_status:    'pending',
  work_date:         '2026-06-02',
  clock_in_at:       '2026-06-02T06:00:00Z',
  clock_out_at:      null,
  entry_status:      'open',
  site_geofence_id:  'geo-1',
  entry_updated_at:  '2026-06-02T06:00:00',
  hours:             null,
};

/** A closed entry for an active technician. */
const ACTIVE_TECH_CLOSED: Record<string, unknown> = {
  entry_id:          'e-closed-1',
  staff_id:          's-tech-active',
  staff_name:        'Mpho Nkosi',
  role:              'technician',
  account_status:    'active',
  work_date:         '2026-06-02',
  clock_in_at:       '2026-06-02T06:00:00Z',
  clock_out_at:      '2026-06-02T14:00:00Z',
  entry_status:      'closed',
  site_geofence_id:  null,
  entry_updated_at:  '2026-06-02T14:00:00',
  hours:             8,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/field/attendance', () => {
  // ── Method guard ────────────────────────────────────────────────────────────

  it('405 on non-GET', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'POST'), res);
    expect(captured.statusCode).toBe(405);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  // ── Date validation ─────────────────────────────────────────────────────────

  it('400 when from is missing', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ to: TO }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('400 when to is missing', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ from: FROM }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('400 when from is not YYYY-MM-DD', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ from: '01/06/2026', to: TO }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('400 when to is not YYYY-MM-DD', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ from: FROM, to: 'today' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  // ── Core Rule-P exemption ───────────────────────────────────────────────────

  it('includes pending technician entry and returns null hours for open entry (Rule-P exempt)', async () => {
    mocks.sql.mockResolvedValue([PENDING_TECH_OPEN]);
    const { res, captured } = makeRes();
    await handler(makeReq({ from: FROM, to: TO }), res);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      success: true;
      data: { rows: typeof PENDING_TECH_OPEN[] };
    };
    expect(body.data.rows).toHaveLength(1);

    const row = body.data.rows[0]!;
    // (a) Pending technician IS present
    expect(row.account_status).toBe('pending');
    expect(row.role).toBe('technician');
    // (c) hours null for open entry
    expect(row.hours).toBeNull();
  });

  it('SQL shape: role IN filter present, no approvedAccountPredicate', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res } = makeRes();
    await handler(makeReq({ from: FROM, to: TO }), res);

    expect(mocks.sql).toHaveBeenCalledOnce();
    const queryText = capturedSql();

    // (b) Role filter must be present — restricted to field-worker roles only
    expect(queryText).toMatch(/role\s+IN\s*\(\s*'technician'\s*,\s*'casual'\s*\)/i);

    // Non-field roles must NOT appear as role values in the IN list
    // (guards against accidentally widening the filter to include managers/admins)
    expect(queryText).not.toMatch(/'manager'/i);
    expect(queryText).not.toMatch(/'admin'/i);

    // Rule-P exemption: must NOT contain any form of pending-exclusion predicate
    expect(queryText).not.toMatch(/account_status\s*<>\s*'pending'/i);
    expect(queryText).not.toMatch(/account_status\s*!=\s*'pending'/i);
    expect(queryText).not.toMatch(/approvedAccountPredicate/i);
  });

  it('SQL shape: hours column uses ::float cast to ensure numeric type from pg driver', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res } = makeRes();
    await handler(makeReq({ from: FROM, to: TO }), res);

    expect(mocks.sql).toHaveBeenCalledOnce();
    const queryText = capturedSql();
    // pg driver serialises Postgres `numeric` as a string; ::float forces a
    // native float so callers receive a JS number, not '8.00'.
    expect(queryText).toMatch(/ROUND\s*\([\s\S]*?\)::float/i);
  });

  it('SQL shape: status=pending branch filters to pending account_status', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res } = makeRes();
    await handler(makeReq({ from: FROM, to: TO, status: 'pending' }), res);

    expect(mocks.sql).toHaveBeenCalledOnce();
    const queryText = capturedSql();

    // The pending filter is an equality check — not an exclusion
    expect(queryText).toMatch(/account_status.*=.*'pending'/i);

    // Still must not exclude pending via inequality
    expect(queryText).not.toMatch(/account_status\s*<>\s*'pending'/i);
    expect(queryText).not.toMatch(/account_status\s*!=\s*'pending'/i);
  });

  it('SQL shape: status=active branch filters to active account_status', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res } = makeRes();
    await handler(makeReq({ from: FROM, to: TO, status: 'active' }), res);

    expect(mocks.sql).toHaveBeenCalledOnce();
    const queryText = capturedSql();
    expect(queryText).toMatch(/account_status.*=.*'active'/i);
  });

  it('SQL shape: status=all branch has no account_status WHERE predicate', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res } = makeRes();
    await handler(makeReq({ from: FROM, to: TO, status: 'all' }), res);

    expect(mocks.sql).toHaveBeenCalledOnce();
    const queryText = capturedSql();
    // The "all" branch must not filter by account_status (no equality or inequality predicate).
    // Note: s.account_status appears in the SELECT list — we only reject WHERE predicates.
    expect(queryText).not.toMatch(/LOWER\s*\(\s*s\.account_status\s*\)\s*=/i);
    expect(queryText).not.toMatch(/s\.account_status\s*(=|<>|!=)/i);
    // Also must never exclude pending via the Rule-P predicate
    expect(queryText).not.toMatch(/account_status\s*<>\s*'pending'/i);
    expect(queryText).not.toMatch(/account_status\s*!=\s*'pending'/i);
  });

  it('returns rows mapped directly from DB for multiple entries', async () => {
    mocks.sql.mockResolvedValue([PENDING_TECH_OPEN, ACTIVE_TECH_CLOSED]);
    const { res, captured } = makeRes();
    await handler(makeReq({ from: FROM, to: TO }), res);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      success: true;
      data: { rows: Record<string, unknown>[] };
    };
    expect(body.data.rows).toHaveLength(2);
    // hours null for open, number for closed
    expect(body.data.rows[0]!.hours).toBeNull();
    expect(body.data.rows[1]!.hours).toBe(8);
  });

  it('500 when DB rejects', async () => {
    mocks.sql.mockRejectedValue(new Error('pg down'));
    const { res, captured } = makeRes();
    await handler(makeReq({ from: FROM, to: TO }), res);
    expect(captured.statusCode).toBe(500);
  });

  it('returns empty rows array when DB returns no results', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res, captured } = makeRes();
    await handler(makeReq({ from: FROM, to: TO }), res);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as { data: { rows: unknown[] } };
    expect(body.data.rows).toEqual([]);
  });
});
