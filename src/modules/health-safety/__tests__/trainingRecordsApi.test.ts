import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, trainingScoreMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  trainingScoreMock: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/auth', () => ({
  withPermission: () => (handler: unknown) => handler,
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
  getAuthUser: vi.fn(() => ({ id: 'user-1', email: 'hs@velocityfibre.co.za' })),
}));
vi.mock('@/modules/health-safety/services/activityLog', () => ({
  logHsActivity: vi.fn(async () => {}),
}));
vi.mock('@/modules/health-safety/services/trainingService', () => ({
  computeAndPersistContractorTrainingScore: trainingScoreMock,
}));

import handler from '../../../../pages/api/health-safety/training/records';

const TEAM_MEMBER_ID = '11111111-2222-4333-8444-555555555555';
const CONTRACTOR_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const TRAINING_TYPE_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

async function post(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await handler(req, res);
  return res;
}

describe('POST /api/health-safety/training/records contractor binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trainingScoreMock.mockResolvedValue({});
  });

  it('rejects a team_member training record without contractor_id before querying', async () => {
    const res = await post({
      training_type_id: TRAINING_TYPE_ID,
      team_member_id: TEAM_MEMBER_ID,
      worker_name: 'Contractor Worker',
      completed_date: '2026-07-29',
    });

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.message).toMatch(/contractor_id is required/);
    expect(sqlMock).not.toHaveBeenCalled();
    expect(trainingScoreMock).not.toHaveBeenCalled();
  });

  it('also rejects a whitespace-only contractor_id instead of sending it to the uuid cast', async () => {
    const res = await post({
      training_type_id: TRAINING_TYPE_ID,
      team_member_id: TEAM_MEMBER_ID,
      contractor_id: '   ',
      worker_name: 'Contractor Worker',
      completed_date: '2026-07-29',
    });

    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
    expect(trainingScoreMock).not.toHaveBeenCalled();
  });

  it('creates a bound team_member record and refreshes that contractor gate score', async () => {
    sqlMock
      .mockResolvedValueOnce([
        { id: TRAINING_TYPE_ID, name: 'Working at Heights', validity_months: 24 },
      ])
      .mockResolvedValueOnce([
        {
          id: 'record-1',
          worker_name: 'Contractor Worker',
          contractor_id: CONTRACTOR_ID,
          completed_date: '2026-07-29',
          expiry_date: '2028-07-29',
        },
      ]);

    const res = await post({
      training_type_id: TRAINING_TYPE_ID,
      team_member_id: TEAM_MEMBER_ID,
      contractor_id: CONTRACTOR_ID,
      worker_name: 'Contractor Worker',
      completed_date: '2026-07-29',
    });

    expect(res._getStatusCode()).toBe(201);
    expect(trainingScoreMock).toHaveBeenCalledTimes(1);
    expect(trainingScoreMock).toHaveBeenCalledWith(CONTRACTOR_ID);
  });
});

describe('manual records are only for competencies that need no certificate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trainingScoreMock.mockResolvedValue({});
  });

  const STAFF_ID = 'cccccccc-dddd-4eee-8fff-000000000000';

  function manualBody(extra: Record<string, unknown> = {}) {
    return {
      training_type_id: TRAINING_TYPE_ID,
      staff_id: STAFF_ID,
      worker_name: 'Internal Worker',
      completed_date: '2026-07-29',
      ...extra,
    };
  }

  it('refuses a certificate-required type and points at the upload flow', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: TRAINING_TYPE_ID, name: 'Working at Heights', validity_months: 24, requires_certificate: true },
    ]);

    const res = await post(manualBody());

    expect(res._getStatusCode()).toBe(400);
    // The user needs to be told where to go, not just that they cannot do this.
    expect(JSON.stringify(res._getData())).toContain('/health-safety/training/certificates/new');
    expect(sqlMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO hs_worker_training'))).toBe(
      false
    );
  });

  it('accepts a no-certificate type as verified legacy evidence', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: TRAINING_TYPE_ID, name: 'OHS Site Induction', validity_months: 12, requires_certificate: false },
    ]);
    sqlMock.mockResolvedValueOnce([{ id: 'rec-1', expiry_date: '2027-07-29' }]);

    const res = await post(manualBody());

    expect(res._getStatusCode()).toBe(201);
    const insert = sqlMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO hs_worker_training'));
    expect(insert).toBeDefined();
    // Nobody verifies an induction register entry, so it is not left pending
    // where it would silently count for nothing.
    expect(String(insert?.[0])).toMatch(/'verified'/);
  });

  it('never writes a caller-supplied certificate_url', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: TRAINING_TYPE_ID, name: 'OHS Site Induction', validity_months: 12, requires_certificate: false },
    ]);
    sqlMock.mockResolvedValueOnce([{ id: 'rec-1' }]);

    await post(manualBody({ certificate_url: 'https://evil.example/free-text' }));

    const insert = sqlMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO hs_worker_training'));
    expect(String(insert?.[0])).not.toContain('certificate_url');
    expect(insert?.slice(1)).not.toContain('https://evil.example/free-text');
  });

  it('the list response carries no storage location', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        id: 'rec-1',
        worker_name: 'Internal Worker',
        verification_status: 'verified',
        competency_status: 'current',
        hasCertificate: true,
      },
    ]);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET', query: {} });
    await handler(req, res);

    const select = String(sqlMock.mock.calls[0]?.[0]);
    expect(select).not.toContain('wt.*');
    expect(select).not.toContain('certificate_url');
    expect(select).not.toContain('file_url');
    expect(select).not.toContain('file_path');
    // The reader still needs to know whether a file exists, just not where.
    expect(select).toMatch(/staff_document_id IS NOT NULL/);
  });
});
