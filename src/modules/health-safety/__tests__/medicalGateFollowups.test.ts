/**
 * Follow-ups from the delayed blind review of PR #2264 / #2268.
 *
 * Four defects that survived the first review round, each pinned here:
 *  1. a contractor worker's medical could be saved with no contractor_id, which
 *     made it invisible to every gate — the one thing the record exists for;
 *  2. the rollup's `current` count overlapped `expiring_soon`, so the three
 *     buckets did not partition the population;
 *  3. an expiring-soon warning was dropped whenever any other worker's
 *     certificate had already expired (`else if` on independent counts);
 *  4. a malformed uuid in the path 500'd instead of 400ing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, trainingMock, medicalMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  trainingMock: vi.fn(),
  medicalMock: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/db-neon', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/auth', () => ({
  withPermission: () => (h: unknown) => h,
  withAuth: (h: (req: NextApiRequest, res: NextApiResponse) => unknown) => h,
  getAuthUser: vi.fn(() => ({ id: 'user-1', email: 'a@velocityfibre.co.za' })),
}));
vi.mock('../services/trainingService', () => ({
  computeAndPersistContractorTrainingScore: trainingMock,
}));
vi.mock('../services/medicalService', () => ({
  computeContractorMedicalSummary: medicalMock,
}));

import listHandler from '../../../../pages/api/health-safety/medicals/index';
import medicalDetailHandler from '../../../../pages/api/health-safety/medicals/[medicalId]';
import libraryDetailHandler from '../../../../pages/api/health-safety/library/[libraryId]';
import { checkContractorGate } from '../services/gateService';

const UUID = '11111111-2222-3333-4444-555555555555';

async function post(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await listHandler(req, res);
  return res;
}

describe('1. contractor_id is required for a contractor worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([{ id: 'new-1', worker_name: 'W' }]);
  });

  it('rejects a team_member medical with no contractor_id', async () => {
    const res = await post({ team_member_id: UUID, exam_date: '2026-03-01', worker_name: 'W' });

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.message).toMatch(/contractor_id is required/);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects a blank contractor_id just as firmly', async () => {
    const res = await post({
      team_member_id: UUID,
      contractor_id: '',
      exam_date: '2026-03-01',
      worker_name: 'W',
    });
    expect(res._getStatusCode()).toBe(400);
  });

  it('accepts a team_member medical that names its contractor', async () => {
    const res = await post({
      team_member_id: UUID,
      contractor_id: UUID,
      exam_date: '2026-03-01',
      worker_name: 'W',
    });
    expect(res._getStatusCode()).toBe(201);
  });

  it('still allows internal staff without a contractor (NULL = Velocity employee)', async () => {
    const res = await post({ staff_id: UUID, exam_date: '2026-03-01', worker_name: 'W' });
    expect(res._getStatusCode()).toBe(201);
  });
});

describe('2. the rollup buckets partition the population', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defines current as excluding the expiring-soon window', async () => {
    // Import the real service (not the mock) to read its SQL text.
    const actual = await vi.importActual<typeof import('../services/medicalService')>(
      '../services/medicalService'
    );
    sqlMock.mockResolvedValueOnce([]);
    await actual.computeContractorMedicalSummary(UUID);

    const sqlText = (sqlMock.mock.calls[0]![0] as string[]).join(' ? ').replace(/\s+/g, ' ');
    // The bug: `expiry_date >= CURRENT_DATE`, which also matches every
    // expiring-soon row. The fix pushes the boundary past the window.
    expect(sqlText).toMatch(/expiry_date IS NULL OR expiry_date > CURRENT_DATE \+ make_interval/);
    expect(sqlText).not.toMatch(/WHERE expiry_date IS NULL OR expiry_date >= CURRENT_DATE \)/);
  });
});

describe('3. expired and expiring-soon are reported independently', () => {
  const COMPLIANCE = {
    contractor_id: 'c1',
    overall_score: 90,
    rag_status: 'green',
    document_score: 90,
    incident_score: 100,
    training_score: null,
    corrective_action_score: 100,
    audit_score: 90,
    next_audit_due: null,
  };
  const VALID_DOCS = [
    { document_type: 'safety_policy', status: 'valid', expiry_date: null },
    { document_type: 'liability_insurance', status: 'valid', expiry_date: null },
    { document_type: 'safety_plan', status: 'valid', expiry_date: null },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock
      .mockResolvedValueOnce([COMPLIANCE])
      .mockResolvedValueOnce(VALID_DOCS)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    trainingMock.mockResolvedValueOnce({
      contractor_id: 'c1',
      total_certs: 4,
      current_certs: 4,
      expiring_certs: 0,
      expired_certs: 0,
      expired_statutory_certs: 0,
      training_score: 100,
    });
  });

  it('reports BOTH when one worker is expired and another is expiring soon', async () => {
    medicalMock.mockResolvedValueOnce({
      contractor_id: 'c1',
      workers_with_medicals: 3,
      current: 1,
      expiring_soon: 2,
      expired: 1,
      unfit: 0,
      restricted: 0,
    });

    const result = await checkContractorGate('c1');

    expect(result.blockers.some((b) => /1 expired medical certificate/.test(b))).toBe(true);
    // The regression: an `else if` here dropped this warning entirely.
    expect(result.warnings.some((w) => /2 medical certificate\(s\) expiring soon/.test(w))).toBe(
      true
    );
  });
});

describe('4. a malformed uuid path param is a 400, not a 500', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
  });

  it.each([
    ['medicals', medicalDetailHandler, 'medicalId'],
    ['library', libraryDetailHandler, 'libraryId'],
  ])('%s detail rejects a non-uuid id before querying', async (_name, handler, key) => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { [key]: 'not-a-uuid' },
    });
    await (handler as (q: NextApiRequest, r: NextApiResponse) => Promise<void>)(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
