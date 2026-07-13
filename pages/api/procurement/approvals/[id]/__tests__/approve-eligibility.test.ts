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

import handler from '../approve';
import { createMocks } from 'node-mocks-http';

beforeEach(() => { rows.length = 0; });

describe('approve.ts eligibility gate', () => {
  it('403 when caller is not the level approver', async () => {
    rows.push([{ id: 'a1', status: 'pending', document_type: 'purchase_order',
      approver_type: 'role', approver_role: 'project_manager', approver_user_id: null, assigned_to: null }]);
    const { req, res } = createMocks({ method: 'POST', query: { id: 'a1' }, body: {} });
    (req as any).__user = { id: 'u1', role: 'field_technician', name: 'T', email: 't@x' };
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(403);
  });
});
