/**
 * A medical certificate is an upload, never a link.
 *
 * A medical fitness certificate is health data — POPIA special personal
 * information. The upload path writes it under `hs-private/`, which nginx
 * refuses, and serves it only through a route that re-checks permission per
 * request. A free-text `certificate_url` bypasses all of that: it cannot be
 * permission-checked, expiry-tracked, or deleted, and it usually points at
 * somewhere outside the company entirely.
 *
 * The column still exists (0 rows; dropping it is a separate contract
 * migration), so nothing at the database level stops it being written again.
 * This test is what stops it — the sibling of
 * trainingRecordCertificateGuard.test.ts, which guards the same property for
 * training.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  sqlCalls: { current: [] as string[] },
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: () => {
    const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(' ? ');
      h.sqlCalls.current.push(text);
      void values;
      // first_name/last_name, matching the columns the handler actually
      // selects. A stub returning some other shape leaves worker_name
      // unresolved, the handler 400s, and the INSERT assertions below would
      // then pass because no SQL ran at all.
      if (text.includes('FROM team_members') || text.includes('FROM staff')) {
        return Promise.resolve([{ first_name: 'Test', last_name: 'Worker' }]);
      }
      return Promise.resolve([
        {
          id: 'med-1',
          worker_name: 'Test Worker',
          exam_date: '2026-01-01',
          expiry_date: '2027-01-01',
          updated_at_token: '2026-01-01 00:00:00+00',
        },
      ]);
    };
    (fn as unknown as { unsafe: (r: string) => string }).unsafe = (r: string) => r;
    return fn;
  },
  neonConfig: {},
}));

vi.mock('@/modules/health-safety/services/hsAuth', () => ({
  withHsPermission: (handler: unknown) => handler,
}));
vi.mock('@/lib/auth', () => ({
  getAuthUser: () => ({ id: 'hs-editor', email: 'hs@velocityfibre.co.za' }),
  withAuth: (handler: unknown) => handler,
  withPermission: () => (handler: unknown) => handler,
}));
vi.mock('@/modules/health-safety/services/activityLog', () => ({ logHsActivity: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import createHandler from '../../../../pages/api/health-safety/medicals/index';

const HOSTILE_URL = 'https://drive.example/anyone-with-the-link/medical.pdf';

async function post(body: Record<string, unknown>) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  await createHandler(req, res);
  return res;
}

/** Every statement the handler sent, as one string. */
const allSql = () => h.sqlCalls.current.join('\n');

beforeEach(() => {
  h.sqlCalls.current = [];
});

describe('medical certificate URL guard', () => {
  it('never writes certificate_url, even when the caller sends one', async () => {
    await post({
      team_member_id: 'tm-1',
      contractor_id: 'con-1',
      exam_date: '2026-01-01',
      outcome: 'fit',
      certificate_url: HOSTILE_URL,
    });

    const insert = allSql();
    // The statement must have run — a guard that passes because nothing
    // happened would pass just as well with the handler deleted.
    expect(insert).toContain('INSERT INTO hs_worker_medicals');
    expect(insert).not.toContain('certificate_url');
  });

  it('still records the certificate number, which is not a link', async () => {
    // Confirms the guard removed the URL rather than the whole certificate
    // block — otherwise the first test would pass on an over-broad deletion.
    await post({
      team_member_id: 'tm-1',
      contractor_id: 'con-1',
      exam_date: '2026-01-01',
      outcome: 'fit',
      certificate_number: 'COF-12345',
    });

    expect(allSql()).toContain('certificate_number');
  });
});
