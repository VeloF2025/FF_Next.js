/**
 * Handler tests for GET /api/staff/attendance-export.
 *
 * Validation only — auth middleware is bypassed in the vi.mock. The real
 * withAuth/withPermission chain is covered by the existing staff-attendance
 * handler tests; no need to re-test identical wiring here.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '../../../../../pages/api/staff/attendance-export';

function makeReq(query: Record<string, string> = {}, method: string = 'GET'): NextApiRequest {
  return { method, query, headers: {}, socket: {} } as unknown as NextApiRequest;
}

function makeRes() {
  const captured: {
    statusCode: number;
    body?: unknown;
    headers: Record<string, string>;
  } = { statusCode: 200, headers: {} };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    send(d: unknown) { captured.body = d; return this; },
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    getHeader() { return undefined; },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

const SAMPLE_ROW = {
  staff_id: 's1',
  employee_id: 'EMP001',
  full_name: 'Alice Example',
  work_date: '2026-04-20',
  clock_in_at: '2026-04-20T06:00:00+00:00',
  clock_out_at: '2026-04-20T14:00:00+00:00',
  regular_hrs: '8.00',
  overtime_hrs: '0.00',
  sunday_hrs: '0.00',
  holiday_hrs: '0.00',
  night_hrs: '0.00',
  wage_amount_cents: null as string | null,
  exceptions_count: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/staff/attendance-export', () => {
  it('405 on non-GET', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'POST'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('400 when week_start is missing / malformed', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: 'not-a-date', format: 'csv' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('400 when week_start is not a Monday (ISO-week enforcement)', async () => {
    const { res, captured } = makeRes();
    // 2026-04-21 is a Tuesday
    await handler(makeReq({ week_start: '2026-04-21', format: 'csv' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('400 when format is neither csv nor xlsx', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'pdf' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('defaults format to csv when omitted', async () => {
    mocks.sql.mockResolvedValueOnce([SAMPLE_ROW]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20' }), res);
    expect(captured.statusCode).toBe(200);
    expect(captured.headers['content-type']).toContain('text/csv');
    expect(captured.headers['content-disposition']).toContain(
      'filename="attendance-week-2026-04-20.csv"'
    );
  });

  it('CSV body starts with the expected header row', async () => {
    mocks.sql.mockResolvedValueOnce([SAMPLE_ROW]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'csv' }), res);
    const body = String(captured.body);
    const firstLine = body.split('\r\n')[0];
    expect(firstLine).toBe(
      'staff_id,employee_id,full_name,work_date,clock_in_at,clock_out_at,' +
        'regular_hrs,overtime_hrs,sunday_hrs,holiday_hrs,night_hrs,wage_amount,exceptions_count'
    );
    expect(body).toContain('Alice Example');
    expect(body).toContain('EMP001');
  });

  it('CSV escapes values containing commas + double-quotes', async () => {
    mocks.sql.mockResolvedValueOnce([
      {
        ...SAMPLE_ROW,
        full_name: 'Smith, Jr. "Bob"',
      },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'csv' }), res);
    const body = String(captured.body);
    expect(body).toContain('"Smith, Jr. ""Bob"""');
  });

  it('xlsx returns a non-empty Buffer parseable back into rows', async () => {
    mocks.sql.mockResolvedValueOnce([SAMPLE_ROW, { ...SAMPLE_ROW, staff_id: 's2' }]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'xlsx' }), res);
    expect(captured.statusCode).toBe(200);
    expect(captured.headers['content-type']).toContain(
      'officedocument.spreadsheetml.sheet'
    );
    expect(captured.headers['content-disposition']).toContain(
      'filename="attendance-week-2026-04-20.xlsx"'
    );
    const buffer = captured.body as Buffer;
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]!];
    expect(sheet).toBeDefined();
    const rows = XLSX.utils.sheet_to_json(sheet!);
    expect(rows.length).toBe(2);
  });

  it('empty result still emits the header row (CSV)', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'csv' }), res);
    expect(captured.statusCode).toBe(200);
    const body = String(captured.body);
    expect(body.split('\r\n')).toHaveLength(1); // header only, no data rows
    expect(body.startsWith('staff_id,')).toBe(true);
  });

  it('wage_amount_cents formatted as decimal rands (cents → R)', async () => {
    mocks.sql.mockResolvedValueOnce([
      { ...SAMPLE_ROW, wage_amount_cents: '123456' },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'csv' }), res);
    const body = String(captured.body);
    expect(body).toContain(',1234.56,');
  });

  it('DB error returns 500', async () => {
    mocks.sql.mockRejectedValueOnce(new Error('connection reset'));
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'csv' }), res);
    expect(captured.statusCode).toBe(500);
  });

  it('rejects Sunday as week_start (ISO-week boundary guard)', async () => {
    const { res, captured } = makeRes();
    // 2026-04-19 is Sunday
    await handler(makeReq({ week_start: '2026-04-19', format: 'csv' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('CSV empty-week header matches populated-week header exactly (column order parity)', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const { res: r1, captured: c1 } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'csv' }), r1);
    mocks.sql.mockResolvedValueOnce([SAMPLE_ROW]);
    const { res: r2, captured: c2 } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'csv' }), r2);

    const emptyHeader = String(c1.body).split('\r\n')[0];
    const fullHeader = String(c2.body).split('\r\n')[0];
    expect(emptyHeader).toBe(fullHeader);
  });

  it('xlsx column order matches the canonical schema', async () => {
    mocks.sql.mockResolvedValueOnce([SAMPLE_ROW]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'xlsx' }), res);
    const buffer = captured.body as Buffer;
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    // header: 1 returns an array-of-arrays so column order is preserved.
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
    expect(rows[0]).toEqual([
      'staff_id',
      'employee_id',
      'full_name',
      'work_date',
      'clock_in_at',
      'clock_out_at',
      'regular_hrs',
      'overtime_hrs',
      'sunday_hrs',
      'holiday_hrs',
      'night_hrs',
      'wage_amount',
      'exceptions_count',
    ]);
  });

  it('CSV escapes fields containing embedded carriage returns and line feeds', async () => {
    // RFC 4180: any field containing CR, LF, or " must be quoted, with "
    // doubled. We already test comma+quote; lock CR and LF explicitly.
    mocks.sql.mockResolvedValueOnce([
      { ...SAMPLE_ROW, full_name: 'Line1\rLine2' },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'csv' }), res);
    const body = String(captured.body);
    expect(body).toMatch(/"Line1\rLine2"/);
  });

  it('NaN-valued hours render as blank (not silently 0.00)', async () => {
    // If the DB ever returns a corrupt numeric, rendering 0.00 looks like
    // "worked nothing" to payroll. Blank + server log is the audit signal.
    mocks.sql.mockResolvedValueOnce([
      { ...SAMPLE_ROW, regular_hrs: 'not-a-number' },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'csv' }), res);
    const body = String(captured.body);
    // Find the row for Alice; the regular_hrs column is 7th (0-indexed 6)
    const dataRow = body.split('\r\n').find((l) => l.includes('Alice Example'))!;
    const cells = dataRow.split(',');
    expect(cells[6]).toBe('');
  });

  it('wage=0 cents renders as "0.00", null wage renders as "" — audit-signal preserved', async () => {
    mocks.sql.mockResolvedValueOnce([
      { ...SAMPLE_ROW, staff_id: 's-zero', wage_amount_cents: '0' },
      { ...SAMPLE_ROW, staff_id: 's-null', wage_amount_cents: null },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ week_start: '2026-04-20', format: 'csv' }), res);
    const lines = String(captured.body).split('\r\n');
    const zeroLine = lines.find((l) => l.startsWith('s-zero,'))!;
    const nullLine = lines.find((l) => l.startsWith('s-null,'))!;
    // The wage_amount column is the 12th (0-indexed 11).
    expect(zeroLine.split(',')[11]).toBe('0.00');
    expect(nullLine.split(',')[11]).toBe('');
  });
});
