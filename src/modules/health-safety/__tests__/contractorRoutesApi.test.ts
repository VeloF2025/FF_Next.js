/**
 * Contractor H&S routes — uuid ids end-to-end + live table names (D4)
 *
 * - gate-check must pass the uuid contractorId through untouched (the old
 *   parseInt truncated '857e...' uuids to 857).
 * - compliance GET must query maintenance_tickets / hs_corrective_actions —
 *   never the long-renamed "tickets" table.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock, gateMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  gateMock: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));

vi.mock('@/lib/auth', () => ({
  
  withPermission: () => (h: unknown) => h,withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
  getAuthUser: vi.fn(() => ({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', email: 'hs@velocityfibre.co.za' })),
}));

vi.mock('@/modules/health-safety/services/gateService', () => ({
  checkContractorGate: (id: unknown) => gateMock(id),
}));

vi.mock('@/modules/health-safety/services/activityLog', () => ({
  logHsActivity: vi.fn(async () => {}),
}));

import gateCheckHandler from '../../../../pages/api/health-safety/contractor/[contractorId]/gate-check';
import complianceHandler from '../../../../pages/api/health-safety/contractor/[contractorId]/compliance';

const CONTRACTOR_ID = '857eaaaa-1111-2222-3333-444444444444';

function q(call: unknown[]): string {
  return (call[0] as string[]).join('$').replace(/\s+/g, ' ');
}

describe('GET /api/health-safety/contractor/[contractorId]/gate-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ');
      if (text.includes('FROM contractors')) {
        return Promise.resolve([{ id: CONTRACTOR_ID, company_name: 'Demo Contractors', status: 'active' }]);
      }
      if (text.includes('COUNT(*)')) {
        return Promise.resolve([{ recent_critical: 0, unresolved: 0 }]);
      }
      return Promise.resolve([]);
    });
    gateMock.mockResolvedValue({
      can_assign: true,
      contractor_id: CONTRACTOR_ID,
      overall_score: 80,
      rag_status: 'green',
      blockers: [],
      warnings: [],
      checked_at: new Date().toISOString(),
      breakdown: {},
      documents: [],
    });
  });

  it('passes the uuid contractor id through untouched (no parseInt)', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { contractorId: CONTRACTOR_ID },
    });
    await gateCheckHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(gateMock).toHaveBeenCalledTimes(1);
    expect(gateMock).toHaveBeenCalledWith(CONTRACTOR_ID);
  });

  it('queries maintenance_tickets (not the dead tickets table) for the breakdown', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { contractorId: CONTRACTOR_ID },
    });
    await gateCheckHandler(req, res);

    const allSql = sqlMock.mock.calls.map(q).join('\n');
    expect(allSql).toContain('maintenance_tickets');
    expect(allSql).not.toMatch(/FROM tickets\b/);
  });
});

describe('GET /api/health-safety/contractor/[contractorId]/compliance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ');
      if (text.includes('FROM contractors')) {
        return Promise.resolve([{ id: CONTRACTOR_ID, company_name: 'Demo Contractors', status: 'active' }]);
      }
      return Promise.resolve([]);
    });
  });

  it('uses live tables: maintenance_tickets, hs_corrective_actions, contractor_projects', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { contractorId: CONTRACTOR_ID },
    });
    await complianceHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const allSql = sqlMock.mock.calls.map(q).join('\n');
    expect(allSql).toContain('FROM maintenance_tickets');
    expect(allSql).toContain('FROM hs_corrective_actions');
    expect(allSql).toContain('contractor_projects');
    expect(allSql).not.toMatch(/FROM tickets\b/);
    expect(allSql).not.toContain('hs_severity');
  });
});
