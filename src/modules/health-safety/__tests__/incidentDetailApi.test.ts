/**
 * Incident detail API — GET /api/health-safety/incidents/[incidentId] (D3/PR-4)
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
  
  withPermission: () => (h: unknown) => h,
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
  getAuthUser: vi.fn(() => ({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })),
}));

import handler from '../../../../pages/api/health-safety/incidents/[incidentId]';

const INCIDENT_ID = '2a493b09-dc79-4ad1-9ece-31af05fe18ae';

function q(call: unknown[]): string {
  return (call[0] as string[]).join('$').replace(/\s+/g, ' ');
}

describe('GET /api/health-safety/incidents/[incidentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the joined incident for a valid id', async () => {
    sqlMock.mockResolvedValue([
      { id: INCIDENT_ID, ticket_uid: 'HS-20260723-032', title: 'Near miss', severity: 'minor', project_name: 'Demo' },
    ]);
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { incidentId: INCIDENT_ID },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const text = q(sqlMock.mock.calls[0]!);
    expect(text).toContain('FROM maintenance_tickets');
    expect(text).toContain('JOIN hs_ticket_details');
    // project join must keep the ::text cast (project_id is TEXT); contractor join must not
    expect(text).toContain('p.id::text = t.project_id');
    expect(text).toContain('c.id = t.contractor_id');
    const body = JSON.parse(res._getData());
    expect(body.data.ticket_uid).toBe('HS-20260723-032');
  });

  it('404s for an unknown id', async () => {
    sqlMock.mockResolvedValue([]);
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { incidentId: INCIDENT_ID },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });
});
