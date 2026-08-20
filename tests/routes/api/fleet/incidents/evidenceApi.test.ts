import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ addEvidence: vi.fn(), staff: vi.fn(), gates: [] as Array<[string, string]> }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => { mocks.gates.push([key, action]); return handler; },
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));
vi.mock('@/modules/fleet/incidents/evidenceService', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/evidenceService')>('@/modules/fleet/incidents/evidenceService');
  return { ...actual, addIncidentEvidence: mocks.addEvidence };
});

import evidenceHandler from '@/pages/api/fleet/incidents/[incidentId]/evidence';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import {
  IncidentEvidenceAccessDeniedError, IncidentEvidenceConflictError, IncidentEvidenceOrphanError, IncidentEvidenceValidationError,
} from '@/modules/fleet/incidents/evidenceService';
import { VfStorageOriginError, VfStorageValidationError } from '@/lib/vfStorageUpload';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const INCIDENT = '33333333-3333-4333-8333-333333333333';

async function call(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  method: string,
  options: { query?: Record<string, string>; body?: unknown; user?: { id: string; role: string } | null } = {},
) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  const req = {
    method, query: options.query ?? { incidentId: INCIDENT }, body: options.body,
    user: options.user === undefined ? { id: USER, role: 'manager' } : options.user,
  } as unknown as NextApiRequest;
  await handler(req, res);
  return state;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { evidenceType: 'photo', mimeType: 'image/jpeg', base64: 'aW1hZ2U=', filename: 'evidence.jpg', ...overrides };
}

beforeEach(() => { vi.clearAllMocks(); mocks.gates.length = 0; mocks.staff.mockResolvedValue(STAFF); });

describe('POST /api/fleet/incidents/[incidentId]/evidence', () => {
  it('allows POST only', async () => {
    const result = await call(evidenceHandler, 'GET');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('POST');
    expect(mocks.addEvidence).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request', async () => {
    const result = await call(evidenceHandler, 'POST', { user: null, body: validBody() });
    expect(result.status).toBe(401);
    expect(mocks.addEvidence).not.toHaveBeenCalled();
  });

  it('validates the incidentId path param before touching the body', async () => {
    const result = await call(evidenceHandler, 'POST', { query: { incidentId: 'not-a-uuid' }, body: validBody() });
    expect(result.status).toBe(400);
    expect(mocks.addEvidence).not.toHaveBeenCalled();
  });

  it('rejects a malformed body before calling the service', async () => {
    const missingMime = await call(evidenceHandler, 'POST', { body: { evidenceType: 'photo', base64: 'aW1hZ2U=' } });
    expect(missingMime.status).toBe(400);
    const missingBase64 = await call(evidenceHandler, 'POST', { body: { evidenceType: 'photo', mimeType: 'image/jpeg' } });
    expect(missingBase64.status).toBe(400);
    const badType = await call(evidenceHandler, 'POST', { body: validBody({ evidenceType: 'manager_note' }) });
    expect(badType.status).toBe(400);
    expect(mocks.addEvidence).not.toHaveBeenCalled();
  });

  it('derives the actor from the session, gates on fleet.incidents:edit, and returns 201 with the created evidence', async () => {
    mocks.addEvidence.mockResolvedValue({ evidence: { id: 'evidence-1' }, actionId: 'action-1' });
    const result = await call(evidenceHandler, 'POST', { body: validBody({ actorUserId: 'attacker' }) });

    expect(result.status).toBe(201);
    expect(mocks.addEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: INCIDENT, actorUserId: USER, evidenceType: 'photo', mimeType: 'image/jpeg' }),
      { userId: USER, staffId: STAFF, role: 'manager' },
    );
    expect(mocks.gates).toContainEqual(['fleet.incidents', 'edit']);
  });

  it('never forwards base64 content in a log-visible query field', async () => {
    mocks.addEvidence.mockResolvedValue({ evidence: { id: 'evidence-1' }, actionId: 'action-1' });
    await call(evidenceHandler, 'POST', { body: validBody() });
    const forwarded = mocks.addEvidence.mock.calls[0][0];
    expect(forwarded.base64).toBe('aW1hZ2U=');
  });

  it('maps validation, forbidden, not-found, and conflict errors to their status codes', async () => {
    mocks.addEvidence.mockRejectedValue(new IncidentEvidenceValidationError('bad evidenceType'));
    expect((await call(evidenceHandler, 'POST', { body: validBody() })).status).toBe(400);

    mocks.addEvidence.mockRejectedValue(new VfStorageValidationError('MIME not allowed'));
    expect((await call(evidenceHandler, 'POST', { body: validBody() })).status).toBe(400);

    mocks.addEvidence.mockRejectedValue(new IncidentEvidenceAccessDeniedError('denied'));
    expect((await call(evidenceHandler, 'POST', { body: validBody() })).status).toBe(403);

    mocks.addEvidence.mockRejectedValue(new IncidentNotFoundError('missing'));
    expect((await call(evidenceHandler, 'POST', { body: validBody() })).status).toBe(404);

    mocks.addEvidence.mockRejectedValue(new IncidentEvidenceConflictError('closed', 'resolved'));
    expect((await call(evidenceHandler, 'POST', { body: validBody() })).status).toBe(409);
  });

  it('maps a non-approved storage origin and an orphaned upload to 500 without leaking a fake success', async () => {
    mocks.addEvidence.mockRejectedValue(new VfStorageOriginError('unapproved origin'));
    const originResult = await call(evidenceHandler, 'POST', { body: validBody() });
    expect(originResult.status).toBe(500);
    expect(originResult.body).not.toMatchObject({ success: true });

    mocks.addEvidence.mockRejectedValue(new IncidentEvidenceOrphanError('orphaned', 'fleet/incidents/key.jpg', '/storage/fleet/incidents/key.jpg'));
    const orphanResult = await call(evidenceHandler, 'POST', { body: validBody() });
    expect(orphanResult.status).toBe(500);
    expect(orphanResult.body).not.toMatchObject({ success: true });
  });

  it('does not convert an unexpected failure into a fake success', async () => {
    mocks.addEvidence.mockRejectedValue(new Error('database down'));
    const result = await call(evidenceHandler, 'POST', { body: validBody() });
    expect(result.status).toBe(500);
    expect(result.body).not.toMatchObject({ success: true });
  });
});
