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
