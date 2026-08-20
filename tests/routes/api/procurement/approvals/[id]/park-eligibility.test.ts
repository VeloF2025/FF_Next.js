import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the neon shim BEFORE importing the handler (see tests/unit/projects/*.test.ts pattern).
const rows: any[] = [];
vi.mock('@neondatabase/serverless', () => ({
  neon: () => {
    const tag = async () => rows.shift() ?? [];
    return tag;
  },
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: any) => (req: any, res: any) => {
    req.user = req.__user ?? { id: 'u1', role: 'field_technician', name: 'T', email: 't@x' };
    return h(req, res);
  },
}));
vi.mock('@/lib/permissions', () => ({
  userHasPermission: vi.fn(),
}));
vi.mock('@/modules/notifications/services', () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/action-items/procurementActions', () => ({
  completeApprovalActionItem: vi.fn().mockResolvedValue(undefined),
}));

import handler from '@/pages/api/procurement/approvals/[id]/park';
import { createMocks } from 'node-mocks-http';
import { userHasPermission } from '@/lib/permissions';

beforeEach(() => {
  rows.length = 0;
  vi.mocked(userHasPermission).mockReset();
});

describe('park.ts eligibility gate', () => {
  it('403 when caller is not eligible and lacks procurement.sourcing:edit', async () => {
    rows.push([{ id: 'a1', status: 'pending', assigned_to: null, document_type: 'purchase_order',
      document_id: 'd1', document_number: 'PO-1', requested_by: 'req1',
      approver_type: 'role', approver_role: 'project_manager', approver_user_id: null }]);
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const { req, res } = createMocks({ method: 'POST', query: { id: 'a1' }, body: {} });
    (req as any).__user = { id: 'u1', role: 'field_technician', name: 'T', email: 't@x' };
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(403);
    // Only the existence SELECT ran — the UPDATE was never reached.
    expect(rows.length).toBe(0);
  });

  it('200 when caller has procurement.sourcing:edit despite not being the level approver', async () => {
    rows.push([{ id: 'a1', status: 'pending', assigned_to: null, document_type: 'purchase_order',
      document_id: 'd1', document_number: 'PO-1', requested_by: 'req1',
      approver_type: 'role', approver_role: 'project_manager', approver_user_id: null }]);
    rows.push([{ id: 'a1', status: 'on_hold', parked_at: new Date().toISOString(), parked_by: 'u1',
      parked_by_name: 'T', park_reason: null, document_type: 'purchase_order', document_id: 'd1',
      document_number: 'PO-1', assigned_to: null, requested_by: 'req1' }]);
    vi.mocked(userHasPermission).mockResolvedValue(true);
    const { req, res } = createMocks({ method: 'POST', query: { id: 'a1' }, body: {} });
    (req as any).__user = { id: 'u1', role: 'field_technician', name: 'T', email: 't@x' };
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().success).toBe(true);
  });
});
