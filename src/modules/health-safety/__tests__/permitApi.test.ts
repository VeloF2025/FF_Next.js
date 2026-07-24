/**
 * H&S permit detail endpoint — server-side guards a blind UI cannot be trusted with.
 * Focuses on the terminal-state edit guard and the transition/precondition gate
 * inside the actual PATCH handler (the pure state machine is covered separately).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: (req: NextApiRequest, res: NextApiResponse) => unknown) => h,
  getAuthUser: vi.fn(() => ({ id: 'user-1', email: 'a@velocityfibre.co.za' })),
}));

import handler from '../../../../pages/api/health-safety/permits/[permitId]';

const HOT_WORK_PRECONDS = [
  { text: 'Fire extinguisher present', required: true },
  { text: 'Fire watch assigned', required: true },
];

function loadedPermit(overrides: Record<string, unknown>) {
  return {
    id: 'permit-1',
    permit_number: 'PTW-20260724-001',
    status: 'requested',
    valid_to: null,
    preconditions: HOT_WORK_PRECONDS,
    precondition_confirmed: [],
    ...overrides,
  };
}

async function patch(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'PATCH',
    query: { permitId: 'permit-1' },
    body,
  });
  await handler(req, res);
  return res;
}

describe('PATCH /api/health-safety/permits/[permitId]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects editing a fields on a CLOSED permit (audit integrity)', async () => {
    sqlMock.mockResolvedValueOnce([loadedPermit({ status: 'closed' })]); // loadPermit
    const res = await patch({ location: 'tampered' });
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.message).toMatch(/Cannot edit a closed permit/);
    // No UPDATE ran — only the load SELECT.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('rejects rewriting confirmed preconditions on an EXPIRED permit', async () => {
    // stored approved but valid_to in the past → effective expired
    sqlMock.mockResolvedValueOnce([loadedPermit({ status: 'approved', valid_to: '2020-01-01T00:00:00Z' })]);
    const res = await patch({ precondition_confirmed: ['Fire extinguisher present', 'Fire watch assigned'] });
    expect(res._getStatusCode()).toBe(400);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('blocks approval until all mandatory preconditions are confirmed', async () => {
    sqlMock.mockResolvedValueOnce([loadedPermit({ status: 'requested', precondition_confirmed: [] })]);
    const res = await patch({ status: 'approved' });
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData()).error.message).toMatch(/preconditions/i);
    expect(sqlMock).toHaveBeenCalledTimes(1); // no UPDATE
  });

  it('approves once all mandatory preconditions are confirmed in the same request', async () => {
    sqlMock
      .mockResolvedValueOnce([loadedPermit({ status: 'requested' })]) // loadPermit
      .mockResolvedValueOnce([loadedPermit({ status: 'approved' })]); // UPDATE ... RETURNING
    const res = await patch({ status: 'approved', precondition_confirmed: ['Fire extinguisher present', 'Fire watch assigned'] });
    expect(res._getStatusCode()).toBe(200);
    // load + update ran (a best-effort logHsActivity call may follow).
    expect(sqlMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
