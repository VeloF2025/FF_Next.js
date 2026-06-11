/**
 * Phone-dedup test for POST /api/my/stores/technicians.
 *
 * Registering a technician whose phone already belongs to a staff row must
 * return the EXISTING row (any role, any status) instead of inserting a
 * duplicate. Duplicates split identity: custody lands on one row while the
 * phone-keyed /my OTP login resolves the other.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock('@/lib/db-pool', () => {
  const sql = (...args: unknown[]) => mockSql(...args);
  sql.query = (...args: unknown[]) => mockSql(...args);
  return { sql };
});
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (handler: (req: NextApiRequest, res: NextApiResponse, session: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(req, res, { staffId: 'stores-staff-1', staffName: 'Store Man' }),
}));
vi.mock('@/modules/field-stock-pwa/lib/storesActor', () => ({
  requireStoresActor: vi.fn(async () => ({
    staffId: 'stores-staff-1',
    staffRole: 'stores',
    authRole: null,
    name: 'Store Man',
  })),
}));

import handler from '../../../pages/api/my/stores/technicians';

const EXISTING = {
  id: 'staff-existing',
  first_name: 'Louis',
  last_name: 'Ellis',
  role: 'stores',
  account_status: 'active',
  created_by_staff_id: null,
};

function makeRes() {
  const res = {} as NextApiResponse & { statusCode?: number; jsonData?: Record<string, unknown> };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as NextApiResponse['status'];
  res.json = vi.fn((data) => {
    res.jsonData = data;
    return res;
  }) as NextApiResponse['json'];
  res.setHeader = vi.fn(() => res) as unknown as NextApiResponse['setHeader'];
  return res;
}

function makePost(body: Record<string, unknown>): NextApiRequest {
  return { method: 'POST', query: {}, body } as unknown as NextApiRequest;
}

describe('POST /api/my/stores/technicians — phone dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the existing staff row when the phone is already registered', async () => {
    mockSql.mockResolvedValueOnce([EXISTING]); // dedup SELECT hit

    const res = makeRes();
    await handler(
      makePost({ firstName: 'Louis', lastName: 'Ellis', phone: '0725723600', role: 'technician' }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const data = res.jsonData?.data as { user: { id: string }; existing: boolean };
    expect(data.user.id).toBe('staff-existing');
    expect(data.existing).toBe(true);
    // Only the dedup SELECT ran — no INSERT
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('creates a new technician when the phone is unknown', async () => {
    mockSql
      .mockResolvedValueOnce([]) // dedup SELECT miss
      .mockResolvedValueOnce([
        { id: 'staff-new', role: 'technician', account_status: 'pending', created_by_staff_id: 'stores-staff-1' },
      ]); // INSERT

    const res = makeRes();
    await handler(
      makePost({ firstName: 'New', lastName: 'Tech', phone: '0821112222', role: 'technician' }),
      res,
    );

    expect(res.statusCode).toBe(201);
    const data = res.jsonData?.data as { user: { id: string } };
    expect(data.user.id).toBe('staff-new');
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  it('still creates when the phone is not parseable as an SA number', async () => {
    // normaliseSaPhone returns null → dedup returns null WITHOUT querying.
    mockSql.mockResolvedValueOnce([
      { id: 'staff-new2', role: 'technician', account_status: 'pending', created_by_staff_id: 'stores-staff-1' },
    ]); // INSERT only

    const res = makeRes();
    await handler(
      makePost({ firstName: 'Odd', lastName: 'Phone', phone: '12345', role: 'technician' }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(mockSql).toHaveBeenCalledTimes(1); // INSERT only, no dedup SELECT
  });
});
