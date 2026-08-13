/**
 * Authorization tests for the PO approve action
 * (PATCH /api/procurement/purchase-orders/[id]  { action: 'approve' }).
 *
 * Before this fix any authenticated user could approve any PO (the service
 * carried a `// TODO: implement role check` and never called canUserApprove).
 * The route now authorizes the approver via poApprovalService.canUserApprove
 * before calling approvePO:
 *   - canUserApprove === false → 403 FORBIDDEN, approvePO NEVER called
 *   - canUserApprove === true  → approvePO called → 200 approved
 *
 * The route uses neon() (not db-pool) and withAuth(handler); only withAuth is
 * stubbed so the test can inject req.user. The approval authority itself is
 * covered by canUserApprove's own logic (super_admin/admin bypass + threshold
 * user/role match) and is mocked here to isolate the route wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const PO_ID = '11111111-2222-4333-8444-555555555555';

const mocks = vi.hoisted(() => ({
  // neon tagged-template: always resolves the current-PO lookup as pending_approval
  sqlTag: vi.fn(() => Promise.resolve([{ status: 'pending_approval', version: 1 }])),
  canUserApprove: vi.fn(),
  approvePO: vi.fn(() => Promise.resolve()),
  createAuditLog: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: () => mocks.sqlTag,
}));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/procurement/approval', () => ({
  poApprovalService: {
    canUserApprove: mocks.canUserApprove,
    approvePO: mocks.approvePO,
  },
}));
vi.mock('@/services/procurement/auditService', () => ({
  createAuditLog: mocks.createAuditLog,
}));
// Keep the handler logic real; only bypass withAuth so we can inject req.user.
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  AuthenticatedRequest: class {},
}));

import handler from '../[id]';

type TestUser = { id: string; role: string; email: string; name?: string };

function invoke(user: TestUser) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'PATCH',
    query: { id: PO_ID },
    body: { action: 'approve', notes: 'ok' },
  });
  (req as unknown as { user: TestUser }).user = user;
  return { res, promise: (handler as unknown as (r: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res) };
}

const requester: TestUser = { id: 'usr-field-worker', role: 'field_worker', email: 'f@x.co' };
const approver: TestUser = { id: 'usr-admin', role: 'admin', email: 'a@x.co' };

describe('PO approve authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sqlTag.mockResolvedValue([{ status: 'pending_approval', version: 1 }]);
  });

  it('rejects an unauthorized approver with 403 and never calls approvePO', async () => {
    mocks.canUserApprove.mockResolvedValue(false);
    const { res, promise } = invoke(requester);
    await promise;

    expect(res._getStatusCode()).toBe(403);
    expect(mocks.canUserApprove).toHaveBeenCalledWith(PO_ID, 'usr-field-worker');
    expect(mocks.approvePO).not.toHaveBeenCalled();
  });

  it('allows an authorized approver and calls approvePO', async () => {
    mocks.canUserApprove.mockResolvedValue(true);
    const { res, promise } = invoke(approver);
    await promise;

    expect(res._getStatusCode()).toBe(200);
    expect(mocks.approvePO).toHaveBeenCalledWith(PO_ID, 'usr-admin', expect.any(String), 'ok');
  });
});
