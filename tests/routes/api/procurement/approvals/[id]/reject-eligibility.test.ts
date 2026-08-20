import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the neon shim BEFORE importing the handler (see tests/unit/projects/*.test.ts pattern).
const rows: any[] = [];
let callCount = 0;
vi.mock('@neondatabase/serverless', () => ({
  neon: () => {
    const tag = async () => {
      callCount++;
      return rows.shift() ?? [];
    };
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

import handler from '@/pages/api/procurement/approvals/[id]/reject';
import { createMocks } from 'node-mocks-http';

beforeEach(() => {
  rows.length = 0;
  callCount = 0;
});

describe('reject.ts eligibility gate', () => {
  it('403 when caller is not the level approver', async () => {
    rows.push([{ id: 'a1', status: 'pending', document_type: 'purchase_order',
      approver_type: 'role', approver_role: 'project_manager', approver_user_id: null, assigned_to: null }]);
    const { req, res } = createMocks({ method: 'POST', query: { id: 'a1' }, body: { reason: 'x' } });
    (req as any).__user = { id: 'u1', role: 'field_technician', name: 'T', email: 't@x' };
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(403);
    // Only the existence SELECT ran — the UPDATE was never reached.
    expect(callCount).toBe(1);
  });
});
