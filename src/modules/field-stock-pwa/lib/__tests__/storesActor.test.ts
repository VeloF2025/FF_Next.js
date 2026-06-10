/**
 * Unit tests for requireStoresActor — the shared auth gate for /my/stores/* routes.
 *
 * Covers the four exit paths:
 *   1. Authorised (stores/admin staff.role, or super_admin/system authRole) → returns actor.
 *   2. No staff row for the session staffId → 403, returns null.
 *   3. Staff row present but role not authorised → 403, returns null.
 *   4. DB resolution throws → 500, returns null (must not escape as an unhandled error).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiResponse } from 'next';

// sql is consumed as a tagged template: sql`...` → sql(stringsArray, ...values).
const mockSql = vi.fn();
vi.mock('@/lib/db-pool', () => ({
  sql: (...args: unknown[]) => mockSql(...args),
}));

vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireStoresActor, resolveStoresActor } from '../storesActor';

interface MockRes {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  setHeader: (...args: unknown[]) => void;
}

function makeRes(): NextApiResponse & MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
    setHeader: vi.fn(),
  };
  return res as unknown as NextApiResponse & MockRes;
}

const STAFF_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  mockSql.mockReset();
});

describe('requireStoresActor', () => {
  it('returns the actor for an authorised stores staff.role', async () => {
    mockSql.mockResolvedValueOnce([
      { id: STAFF_ID, role: 'stores', auth_role: null, first_name: 'Sam', last_name: 'Stores' },
    ]);
    const res = makeRes();

    const actor = await requireStoresActor(res, STAFF_ID);

    expect(actor).toEqual({ staffId: STAFF_ID, staffRole: 'stores', authRole: null, name: 'Sam Stores' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('admits a non-stores staff.role when authRole is super_admin', async () => {
    mockSql.mockResolvedValueOnce([
      { id: STAFF_ID, role: 'technician', auth_role: 'super_admin', first_name: 'Su', last_name: 'Admin' },
    ]);
    const res = makeRes();

    const actor = await requireStoresActor(res, STAFF_ID);

    expect(actor?.staffId).toBe(STAFF_ID);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 + null when no staff row matches the session', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = makeRes();

    const actor = await requireStoresActor(res, STAFF_ID);

    expect(actor).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 + null when the staff role is not authorised', async () => {
    mockSql.mockResolvedValueOnce([
      { id: STAFF_ID, role: 'technician', auth_role: null, first_name: 'Tina', last_name: 'Tech' },
    ]);
    const res = makeRes();

    const actor = await requireStoresActor(res, STAFF_ID);

    expect(actor).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('returns 500 + null (does not throw) when actor resolution fails', async () => {
    mockSql.mockRejectedValueOnce(new Error('connection refused'));
    const res = makeRes();

    const actor = await requireStoresActor(res, STAFF_ID);

    expect(actor).toBeNull();
    expect(res.statusCode).toBe(500);
  });
});

describe('resolveStoresActor', () => {
  it('maps null name parts to a trimmed empty string', async () => {
    mockSql.mockResolvedValueOnce([
      { id: STAFF_ID, role: 'admin', auth_role: null, first_name: null, last_name: null },
    ]);

    const actor = await resolveStoresActor(STAFF_ID);

    expect(actor).toEqual({ staffId: STAFF_ID, staffRole: 'admin', authRole: null, name: '' });
  });

  it('returns null when the staff row is absent', async () => {
    mockSql.mockResolvedValueOnce([]);
    expect(await resolveStoresActor(STAFF_ID)).toBeNull();
  });
});
