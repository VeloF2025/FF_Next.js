/**
 * Project H&S Config PUT — audit scope handling (D1)
 *
 * - Body contains template_id (uuid) → upsert sets it.
 * - Body contains template_id: null → upsert CLEARS it (scope = all categories).
 * - Body omits the template_id key entirely → existing value preserved.
 *
 * Also: the completed-audits stat must count requires_action as completed (D7).
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
  getAuthUser: vi.fn(() => ({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', email: 'admin@velocityfibre.co.za' })),
}));

import handler from '../../../../pages/api/health-safety/project/[projectId]/config';

const PROJECT_ID = '11111111-2222-3333-4444-555555555555';
const TEMPLATE_ID = '430a8f91-565e-4b96-bf22-f4cbdc84c229';

function q(call: unknown[]): string {
  return (call[0] as string[]).join('$').replace(/\s+/g, ' ');
}

function putConfig(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'PUT',
    query: { projectId: PROJECT_ID },
    body,
  });
  return { req, res };
}

function mockProjectAndUpsert() {
  sqlMock.mockImplementation((strings: string[]) => {
    const text = strings.join('$').replace(/\s+/g, ' ');
    if (text.includes('FROM projects')) {
      return Promise.resolve([{ id: PROJECT_ID, project_name: 'Demo' }]);
    }
    if (text.includes('INSERT INTO hs_project_config')) {
      return Promise.resolve([{ id: 'cfg-1', project_id: PROJECT_ID }]);
    }
    return Promise.resolve([]);
  });
}

describe('PUT /api/health-safety/project/[projectId]/config — audit scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectAndUpsert();
  });

  it('sets template_id when provided', async () => {
    const { req, res } = putConfig({ template_id: TEMPLATE_ID, audit_frequency: 'weekly' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const upsert = sqlMock.mock.calls.find((c) => q(c).includes('INSERT INTO hs_project_config'));
    expect(upsert).toBeDefined();
    expect(upsert!.slice(1)).toContain(TEMPLATE_ID);
    // The update path must assign the provided value, not COALESCE-keep
    expect(q(upsert!)).not.toMatch(/template_id = COALESCE/);
  });

  it('clears template_id when explicitly null (all-categories scope)', async () => {
    const { req, res } = putConfig({ template_id: null, audit_frequency: 'weekly' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const upsert = sqlMock.mock.calls.find((c) => q(c).includes('INSERT INTO hs_project_config'));
    expect(upsert).toBeDefined();
    expect(q(upsert!)).not.toMatch(/template_id = COALESCE/);
  });

  it('preserves existing template_id when the key is omitted', async () => {
    const { req, res } = putConfig({ audit_frequency: 'monthly' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const upsert = sqlMock.mock.calls.find((c) => q(c).includes('INSERT INTO hs_project_config'));
    expect(upsert).toBeDefined();
    // Preserve path: update keeps the stored value verbatim (the old COALESCE
    // form must be gone — it could never clear the value)
    expect(q(upsert!)).toMatch(/template_id = hs_project_config\.template_id/);
    expect(q(upsert!)).not.toMatch(/template_id = COALESCE/);
  });
});

describe('GET config — completed count includes requires_action (D7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockImplementation((strings: string[]) => {
      const text = strings.join('$').replace(/\s+/g, ' ');
      if (text.includes('FROM hs_project_config')) {
        return Promise.resolve([{ id: 'cfg-1', project_id: PROJECT_ID, project_name: 'Demo', template_id: null }]);
      }
      if (text.includes('FROM hs_project_audits')) {
        return Promise.resolve([{ total_audits: 3, completed_audits: 2, average_score: 80 }]);
      }
      return Promise.resolve([]);
    });
  });

  it('counts completed + requires_action together', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { projectId: PROJECT_ID },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const statsCall = sqlMock.mock.calls.find((c) => q(c).includes('FROM hs_project_audits'));
    expect(statsCall).toBeDefined();
    expect(q(statsCall!)).toMatch(/status IN \('completed', ?'requires_action'\)/);
  });
});
