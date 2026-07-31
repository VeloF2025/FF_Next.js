/**
 * A certificate-linked competency is not mutable through the H&S endpoints.
 *
 * /api/health-safety/training/records/[recordId] is gated on
 * projects.health-safety:edit — deliberately NOT the dedicated certificate
 * permission — and knows nothing about the lifecycle. Left open it defeats the
 * whole separation this feature exists to create:
 *
 *   PATCH  — extend a verified statutory competency's expiry with no
 *            certificate, no verifier and no lifecycle event; the gate keeps
 *            counting it because verification_status is untouched.
 *   DELETE — remove the last linked row and the document is stranded forever:
 *            it can never be revoked (the transition refuses a submission with
 *            no linked rows) and never be deleted (verified/revoked are
 *            immutable), leaving its binary unreachable in storage.
 *
 * Both must be refused on provenance, whatever permission the caller holds.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const h = vi.hoisted(() => ({
  sqlCalls: { current: [] as string[] },
  linkedDocumentId: { current: null as string | null },
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: () => {
    const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(' ? ');
      h.sqlCalls.current.push(text);
      void values;
      if (text.includes('SELECT staff_document_id')) {
        return Promise.resolve([{ staff_document_id: h.linkedDocumentId.current }]);
      }
      return Promise.resolve([
        { id: 'rec-1', worker_name: 'Test Worker', contractor_id: null, expiry_date: '2032-01-01' },
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
}));
vi.mock('@/modules/health-safety/services/activityLog', () => ({ logHsActivity: vi.fn() }));
vi.mock('@/modules/health-safety/services/trainingService', () => ({
  computeAndPersistContractorTrainingScore: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import handler from '../../../../pages/api/health-safety/training/records/[recordId]';

const DOCUMENT_ID = '33333333-3333-3333-3333-333333333333';

async function call(method: string, body: Record<string, unknown> = {}) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method,
    query: { recordId: 'rec-1' },
    body,
  });
  await handler(req, res);
  return res;
}

const wrote = () =>
  h.sqlCalls.current.some(
    (q) => q.includes('UPDATE hs_worker_training') || q.includes('DELETE FROM hs_worker_training')
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.sqlCalls.current = [];
});

describe('a competency evidenced by an uploaded certificate', () => {
  beforeEach(() => {
    h.linkedDocumentId.current = DOCUMENT_ID;
  });

  it('cannot have its expiry extended', async () => {
    const res = await call('PATCH', { expiry_date: '2032-01-01' });

    expect(res._getStatusCode()).toBe(409);
    expect(wrote()).toBe(false);
    // The message has to say where to go, not just refuse.
    expect(JSON.stringify(res._getData())).toMatch(/revoke the certificate/i);
  });

  it('cannot have its certificate number or provider rewritten', async () => {
    const res = await call('PATCH', { certificate_number: 'FORGED-1', issued_by: 'Nobody' });
    expect(res._getStatusCode()).toBe(409);
    expect(wrote()).toBe(false);
  });

  it('cannot be deleted out from under its document', async () => {
    const res = await call('DELETE');
    expect(res._getStatusCode()).toBe(409);
    expect(wrote()).toBe(false);
  });
});

describe('a manually recorded competency is unaffected', () => {
  beforeEach(() => {
    h.linkedDocumentId.current = null;
  });

  it('can still be edited', async () => {
    const res = await call('PATCH', { expiry_date: '2027-01-01' });
    expect(res._getStatusCode()).toBe(200);
    expect(h.sqlCalls.current.some((q) => q.includes('UPDATE hs_worker_training'))).toBe(true);
  });

  it('can still be deleted', async () => {
    const res = await call('DELETE');
    expect(res._getStatusCode()).toBe(200);
    expect(h.sqlCalls.current.some((q) => q.includes('DELETE FROM hs_worker_training'))).toBe(true);
  });
});

describe('the free-text certificate URL is gone from this endpoint too', () => {
  it('never writes certificate_url, even when the caller sends one', async () => {
    h.linkedDocumentId.current = null;
    await call('PATCH', { certificate_url: 'https://evil.example/free-text' });

    const update = h.sqlCalls.current.find((q) => q.includes('UPDATE hs_worker_training'));
    expect(update).toBeDefined();
    expect(update).not.toContain('certificate_url');
  });
});
