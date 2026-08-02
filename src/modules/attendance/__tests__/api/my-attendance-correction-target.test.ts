import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  sql: vi.fn(),
  listOwnAdjustments: vi.fn(),
  countOwnAdjustmentsByStatus: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query, sql: mocks.sql }));
vi.mock('@/modules/attendance/corrections/queries', () => ({
  listOwnAdjustments: mocks.listOwnAdjustments,
  countOwnAdjustmentsByStatus: mocks.countOwnAdjustmentsByStatus,
  insertAdjustment: vi.fn(),
  cancelOwnAdjustment: vi.fn(),
}));
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession: (handler: (
    req: NextApiRequest,
    res: NextApiResponse,
    session: { staffId: string; sessionId: string; loginMethod: 'pin' },
  ) => unknown) => (req: NextApiRequest, res: NextApiResponse) =>
    handler(req, res, { staffId: '11111111-1111-4111-8111-111111111111', sessionId: 'session-1', loginMethod: 'pin' }),
}));

import handler from '../../../../../pages/api/my/attendance-corrections';

const EXCEPTION_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';

function makeRes() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    send(body: unknown) { captured.body = body; return this; },
    setHeader: vi.fn(),
  } as unknown as NextApiResponse;
  return { res, captured };
}

async function invoke(exceptionId: string | string[]) {
  const req = { method: 'GET', query: { exception_id: exceptionId }, headers: {} } as unknown as NextApiRequest;
  const { res, captured } = makeRes();
  await handler(req, res);
  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listOwnAdjustments.mockResolvedValue([]);
  mocks.countOwnAdjustmentsByStatus.mockResolvedValue({ pending: 0, approved: 0, rejected: 0, cancelled: 0 });
});

describe('GET /api/my/attendance-corrections?exception_id=', () => {
  it('resolves only the exact current owned missing-clock-out entry', async () => {
    mocks.query.mockResolvedValue([{ exception_id: EXCEPTION_ID, entry_id: ENTRY_ID }]);

    const response = await invoke(EXCEPTION_ID);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { correctionTarget: { exceptionId: EXCEPTION_ID, entryId: ENTRY_ID } },
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [statement, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['11111111-1111-4111-8111-111111111111', EXCEPTION_ID]);
    expect(statement).toMatch(/de\.id = \$2::uuid/i);
    expect(statement).toMatch(/de\.staff_id = \$1::uuid/i);
    expect(statement).toMatch(/de\.kind = 'missing_clock_out'/i);
    expect(statement).toMatch(/de\.status = 'awaiting_worker'/i);
    expect(statement).toMatch(/de\.adjustment_id IS NULL/i);
    expect(statement).toMatch(/de\.resolved_at IS NULL/i);
    expect(statement).toMatch(/de\.entry_id IS NOT NULL/i);
    expect(statement).toMatch(/e\.staff_id = de\.staff_id/i);
    expect(statement).toMatch(/e\.clock_out_at IS NULL/i);
    expect(statement).toMatch(/ds\.result_version = de\.result_version/i);
    expect(statement).toMatch(/LIMIT 1/i);
    expect(mocks.listOwnAdjustments).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign owner'], ['resolved'], ['wrong kind'], ['no entry'], ['stale result version'],
  ])('returns the same fail-closed 404 for %s', async () => {
    mocks.query.mockResolvedValue([]);
    const response = await invoke(EXCEPTION_ID);
    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.listOwnAdjustments).not.toHaveBeenCalled();
  });

  it.each([
    ['not-a-uuid'],
    [[EXCEPTION_ID, '44444444-4444-4444-8444-444444444444']],
  ])('rejects invalid exception_id %j before querying', async (exceptionId) => {
    const response = await invoke(exceptionId);
    expect(response.statusCode).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.listOwnAdjustments).not.toHaveBeenCalled();
  });
});
