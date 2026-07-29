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
  
  withPermission: () => (h: unknown) => h,
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
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
import documentsHandler from '../../../../pages/api/health-safety/contractor/[contractorId]/documents';

const CONTRACTOR_ID = '857eaaaa-1111-2222-3333-444444444444';

// Deliberately-mismatched sentinels for the raw-vs-display date split
// (feat/hs-contractor-docs-date-tz). In real Postgres output these two values
// always represent the same underlying date; using distinct, contradictory
// values here lets a single assertion prove which field each code path reads:
// if the gate/compliance compare used DISPLAY_SENTINEL (a date in 1900) instead
// of the raw `expiry_date`, the document would wrongly classify as expired; if
// the client response leaked the raw Date object instead of the display
// sentinel, the assertion on the returned string would fail.
const RAW_EXPIRY_NOT_EXPIRED = new Date('2099-01-01T00:00:00.000Z');
const DISPLAY_SENTINEL = '1900-01-01';
const ISSUE_SENTINEL = '2020-06-15';

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
      breakdown: {
        training_score: 100,
        training_passed: true,
        training_expired_statutory_certs: 0,
      },
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

  it('does not show a green training panel when the gate blocks on training', async () => {
    gateMock.mockResolvedValueOnce({
      can_assign: false,
      contractor_id: CONTRACTOR_ID,
      overall_score: 80,
      rag_status: 'green',
      blockers: ['Training compliance (50%) below minimum (70%)'],
      warnings: [],
      checked_at: new Date().toISOString(),
      breakdown: {
        training_score: 50,
        training_passed: false,
        training_expired_statutory_certs: 0,
      },
      documents: [],
    });
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { contractorId: CONTRACTOR_ID },
    });

    await gateCheckHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.data.gate.passed).toBe(false);
    expect(body.data.breakdown.training).toMatchObject({
      passed: false,
      score: 50,
      expired_statutory_certs: 0,
    });
    expect(body.data.breakdown.overall.passed).toBe(false);
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

  it('gate compare reads the raw expiry_date; the client response gets the display alias', async () => {
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ');
      if (text.includes('FROM contractors')) {
        return Promise.resolve([{ id: CONTRACTOR_ID, company_name: 'Demo Contractors', status: 'active' }]);
      }
      if (text.includes('FROM hs_contractor_documents')) {
        return Promise.resolve([
          {
            id: 'doc-1',
            contractor_id: CONTRACTOR_ID,
            document_type: 'liability_insurance',
            file_name: 'insurance.pdf',
            file_url: null,
            status: 'valid',
            expiry_date: RAW_EXPIRY_NOT_EXPIRED,
            expiry_date_display: DISPLAY_SENTINEL,
            created_at: new Date('2026-01-01'),
            updated_at: new Date('2026-01-01'),
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { contractorId: CONTRACTOR_ID },
    });
    await complianceHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    // Gate compare used the raw (far-future) expiry_date — the document counts as valid.
    expect(body.data.documents.valid_count).toBe(1);
    // The client-facing item shows the display alias, not the raw Date/shifted value.
    expect(body.data.documents.items[0].expiry_date).toBe(DISPLAY_SENTINEL);
  });
});

describe('GET /api/health-safety/contractor/[contractorId]/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ');
      if (text.includes('FROM contractors')) {
        return Promise.resolve([{ id: CONTRACTOR_ID, company_name: 'Demo Contractors' }]);
      }
      if (text.includes('FROM hs_contractor_documents')) {
        return Promise.resolve([
          {
            id: 'doc-1',
            contractor_id: CONTRACTOR_ID,
            document_type: 'liability_insurance',
            status: 'valid',
            issue_date: ISSUE_SENTINEL,
            expiry_date: RAW_EXPIRY_NOT_EXPIRED,
            expiry_date_display: DISPLAY_SENTINEL,
            expiry_status: 'valid',
          },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  it('compliance-loop gate compare reads raw expiry_date; response gets the display alias', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { contractorId: CONTRACTOR_ID },
    });
    await documentsHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    // The required doc's gate status is 'valid' — proves the compare used the
    // raw (far-future) expiry_date, not DISPLAY_SENTINEL (which is in 1900 and
    // would have classified as expired/invalid if it had leaked into the compare).
    expect(body.data.compliance.liability_insurance.status).toBe('valid');
    // Every place the row is returned shows the display alias for expiry_date,
    // and the already-cast issue_date passes through unchanged.
    expect(body.data.documents[0].expiry_date).toBe(DISPLAY_SENTINEL);
    expect(body.data.documents[0].issue_date).toBe(ISSUE_SENTINEL);
    expect(body.data.by_type.liability_insurance[0].expiry_date).toBe(DISPLAY_SENTINEL);
    expect(body.data.documents[0]).not.toHaveProperty('expiry_date_display');
  });
});

describe('GET /api/health-safety/contractor/[contractorId]/gate-check', () => {
  it('gate valid-check reads raw expiry_date; the `expires` field gets the display alias', async () => {
    vi.clearAllMocks();
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ');
      if (text.includes('FROM contractors')) {
        return Promise.resolve([{ id: CONTRACTOR_ID, company_name: 'Demo Contractors', status: 'active' }]);
      }
      if (text.includes('FROM hs_contractor_documents')) {
        return Promise.resolve([
          {
            document_type: 'liability_insurance',
            status: 'valid',
            expiry_date: RAW_EXPIRY_NOT_EXPIRED,
            expiry_date_display: DISPLAY_SENTINEL,
          },
        ]);
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

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { contractorId: CONTRACTOR_ID },
    });
    await gateCheckHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    const docBreakdown = body.data.breakdown.documents.status.liability_insurance;
    // `valid` used the raw (far-future) expiry_date — proves the compare wasn't
    // corrupted by the display alias (which is in 1900).
    expect(docBreakdown.valid).toBe(true);
    // `expires` — the client-facing field — shows the display alias.
    expect(docBreakdown.expires).toBe(DISPLAY_SENTINEL);
  });
});
