/**
 * Project Audits POST — multi-template seeding + empty-scope guard (D1)
 *
 * - No config.template_id → seed hs_audit_responses from ALL active templates
 *   that have items (single INSERT..SELECT joining hs_checklist_templates).
 * - config.template_id set → seed from that template only (backward compat).
 * - Zero seedable items → 400 with a clear error and NO audit row created.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, logHsActivityMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  logHsActivityMock: vi.fn(async () => {}),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));

vi.mock('@/lib/auth', () => ({
  
  withPermission: () => (h: unknown) => h,
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
  getAuthUser: vi.fn(() => ({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', email: 'auditor@velocityfibre.co.za' })),
}));

vi.mock('@/modules/health-safety/services/activityLog', () => ({
  logHsActivity: (entry: unknown) => logHsActivityMock(entry),
}));

import handler from '../../../../pages/api/health-safety/project/[projectId]/audits';

const PROJECT_ID = '11111111-2222-3333-4444-555555555555';
const TEMPLATE_ID = '430a8f91-565e-4b96-bf22-f4cbdc84c229';
const AUDIT = { id: '99999999-8888-7777-6666-555555555555', status: 'in_progress' };

function q(call: unknown[]): string {
  return (call[0] as string[]).join('?').replace(/\s+/g, ' ');
}

function postAudit() {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    query: { projectId: PROJECT_ID },
    body: { audit_type: 'routine' },
  });
  return { req, res };
}

describe('POST /api/health-safety/project/[projectId]/audits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('seeds from ALL active templates when config has no template_id', async () => {
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ');
      if (text.includes('FROM projects p')) {
        return Promise.resolve([{ id: PROJECT_ID, project_name: 'Demo', template_id: null }]);
      }
      if (text.includes('COUNT(*)') && text.includes('hs_checklist_items')) {
        return Promise.resolve([{ count: 24 }]);
      }
      if (text.includes('INSERT INTO hs_project_audits')) {
        return Promise.resolve([AUDIT]);
      }
      if (text.includes('INSERT INTO hs_audit_responses')) {
        return Promise.resolve(Array.from({ length: 24 }, (_, i) => ({ id: `r${i}` })));
      }
      return Promise.resolve([]);
    });

    const { req, res } = postAudit();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const seedCall = sqlMock.mock.calls.find((c) => q(c).includes('INSERT INTO hs_audit_responses'));
    expect(seedCall).toBeDefined();
    const seedText = q(seedCall!);
    // Single INSERT..SELECT over all active templates — not a per-item loop
    expect(seedText).toContain('SELECT');
    expect(seedText).toContain('hs_checklist_templates');
    expect(seedText).toContain('is_active');
  });

  it('restricts seeding to the configured template when template_id is set', async () => {
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ');
      if (text.includes('FROM projects p')) {
        return Promise.resolve([{ id: PROJECT_ID, project_name: 'Demo', template_id: TEMPLATE_ID }]);
      }
      if (text.includes('COUNT(*)') && text.includes('hs_checklist_items')) {
        return Promise.resolve([{ count: 5 }]);
      }
      if (text.includes('INSERT INTO hs_project_audits')) {
        return Promise.resolve([AUDIT]);
      }
      if (text.includes('INSERT INTO hs_audit_responses')) {
        return Promise.resolve(Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` })));
      }
      return Promise.resolve([]);
    });

    const { req, res } = postAudit();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const seedCall = sqlMock.mock.calls.find((c) => q(c).includes('INSERT INTO hs_audit_responses'));
    expect(seedCall).toBeDefined();
    expect(q(seedCall!)).toContain('template_id');
    expect(seedCall!.slice(1)).toContain(TEMPLATE_ID);
  });

  it('rolls the audit back when seeding inserts zero rows (count/seed race)', async () => {
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ');
      if (text.includes('FROM projects p')) {
        return Promise.resolve([{ id: PROJECT_ID, project_name: 'Demo', template_id: null }]);
      }
      if (text.includes('COUNT(*)') && text.includes('hs_checklist_items')) {
        return Promise.resolve([{ count: 24 }]);
      }
      if (text.includes('INSERT INTO hs_project_audits')) {
        return Promise.resolve([AUDIT]);
      }
      // Seed INSERT..SELECT finds nothing (templates changed between queries)
      if (text.includes('INSERT INTO hs_audit_responses')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { req, res } = postAudit();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    const auditDelete = sqlMock.mock.calls.find((c) => q(c).includes('DELETE FROM hs_project_audits'));
    expect(auditDelete).toBeDefined();
    expect(auditDelete!.slice(1)).toContain(AUDIT.id);
  });

  it('returns 400 and creates NO audit when the scope has zero items', async () => {
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ');
      if (text.includes('FROM projects p')) {
        return Promise.resolve([{ id: PROJECT_ID, project_name: 'Demo', template_id: null }]);
      }
      if (text.includes('COUNT(*)') && text.includes('hs_checklist_items')) {
        return Promise.resolve([{ count: 0 }]);
      }
      return Promise.resolve([]);
    });

    const { req, res } = postAudit();
    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const auditInsert = sqlMock.mock.calls.find((c) => q(c).includes('INSERT INTO hs_project_audits'));
    expect(auditInsert).toBeUndefined();
    const body = JSON.parse(res._getData());
    expect(JSON.stringify(body).toLowerCase()).toContain('checklist');
  });
});
