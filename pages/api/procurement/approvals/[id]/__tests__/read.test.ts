import { describe, it, expect, vi, beforeEach } from 'vitest';
const rows: any[] = [];
vi.mock('@neondatabase/serverless', () => ({
  neon: () => async () => rows.shift() ?? [],
  neonConfig: { fetchConnectionCache: false },
}));
vi.mock('@/lib/auth', () => ({ withAuth: (h: any) => (req: any, res: any) => {
  req.user = req.__user ?? { id: 'u1', role: 'super_admin', name: 'A', email: 'a@x' }; return h(req, res); } }));
import handler from '../index';
import { createMocks } from 'node-mocks-http';
beforeEach(() => { rows.length = 0; });

it('returns the record with canAct=true for super_admin', async () => {
  rows.push([{ id: 'a1', document_type: 'purchase_order', document_id: 'po1', document_number: 'PO-1',
    document_amount: '45000', status: 'pending', requested_by: 'r1', requested_by_name: 'R',
    requested_at: '2026-07-13T10:00:00Z', request_notes: null, due_date: null, is_overdue: false,
    workflow_name: 'PO Approval', level_name: 'L1', level_number: 1,
    approver_type: 'role', approver_user_id: null, approver_role: 'admin', assigned_to: null }]);
  const { req, res } = createMocks({ method: 'GET', query: { id: 'a1' } });
  await handler(req as any, res as any);
  expect(res._getStatusCode()).toBe(200);
  const body = JSON.parse(res._getData());
  expect(body.data.documentNumber).toBe('PO-1');
  expect(body.data.canAct).toBe(true);
  expect(body.data.documentAmount).toBe(45000);
});

it('404 when missing', async () => {
  rows.push([]);
  const { req, res } = createMocks({ method: 'GET', query: { id: 'nope' } });
  await handler(req as any, res as any);
  expect(res._getStatusCode()).toBe(404);
});
