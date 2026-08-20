import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requestDriverInput: vi.fn(), staff: vi.fn(), gates: [] as Array<[string, string]> }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => { mocks.gates.push([key, action]); return handler; },
}));
vi.mock('@/modules/fleet/parking/staffLookup', () => ({ resolveStaffIdForUser: mocks.staff }));
vi.mock('@/modules/fleet/incidents/driver/requestInputService', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/driver/requestInputService')>(
    '@/modules/fleet/incidents/driver/requestInputService',
  );
  return { ...actual, requestDriverInput: mocks.requestDriverInput };
});

import requestDriverInputHandler from '@/pages/api/fleet/incidents/[incidentId]/request-driver-input';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import {
  DriverInputAccessDeniedError, DriverInputRequestConflictError, DriverInputRequestValidationError,
} from '@/modules/fleet/incidents/driver/requestInputService';

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
  return { idempotencyKey: 'req-key-1', guidance: 'Please explain the late start', ...overrides };
}

beforeEach(() => { vi.clearAllMocks(); mocks.gates.length = 0; mocks.staff.mockResolvedValue(STAFF); });

describe('POST /api/fleet/incidents/[incidentId]/request-driver-input', () => {
  it('allows POST only', async () => {
    const result = await call(requestDriverInputHandler, 'GET');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('POST');
    expect(mocks.requestDriverInput).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request', async () => {
    const result = await call(requestDriverInputHandler, 'POST', { user: null, body: validBody() });
    expect(result.status).toBe(401);
    expect(mocks.requestDriverInput).not.toHaveBeenCalled();
  });

  it('validates the incidentId path param before touching the body', async () => {
    const result = await call(requestDriverInputHandler, 'POST', { query: { incidentId: 'not-a-uuid' }, body: validBody() });
    expect(result.status).toBe(400);
    expect(mocks.requestDriverInput).not.toHaveBeenCalled();
  });

  it('rejects a malformed body before calling the service', async () => {
    const missingKey = await call(requestDriverInputHandler, 'POST', { body: { guidance: 'x' } });
    expect(missingKey.status).toBe(400);
    const blankKey = await call(requestDriverInputHandler, 'POST', { body: { idempotencyKey: '   ' } });
    expect(blankKey.status).toBe(400);
    const badGuidanceType = await call(requestDriverInputHandler, 'POST', { body: { idempotencyKey: 'k', guidance: 42 } });
    expect(badGuidanceType.status).toBe(400);
    const badRespondByType = await call(requestDriverInputHandler, 'POST', { body: { idempotencyKey: 'k', respondBy: 42 } });
    expect(badRespondByType.status).toBe(400);
    expect(mocks.requestDriverInput).not.toHaveBeenCalled();
  });

  it('derives the actor scope from the session, gates on fleet.incidents:edit, and returns 200 with the request result', async () => {
    mocks.requestDriverInput.mockResolvedValue({
      inputRequestId: 'req-1', incidentId: INCIDENT, respondBy: '2099-01-01T00:00:00.000Z',
      driverInputState: 'requested', notification: { delivered: 1, suppressed: 0, failed: 0 },
    });

    const result = await call(requestDriverInputHandler, 'POST', { body: validBody() });

    expect(result.status).toBe(200);
    expect(mocks.requestDriverInput).toHaveBeenCalledWith(
      { incidentId: INCIDENT, guidance: 'Please explain the late start', respondBy: null, idempotencyKey: 'req-key-1' },
      { userId: USER, staffId: STAFF, role: 'manager' },
    );
    expect(mocks.gates).toContainEqual(['fleet.incidents', 'edit']);
  });

  it('never trusts an actor/staff identity supplied in the body', async () => {
    mocks.requestDriverInput.mockResolvedValue({
      inputRequestId: 'req-1', incidentId: INCIDENT, respondBy: '2099-01-01T00:00:00.000Z',
      driverInputState: 'requested', notification: { delivered: 1, suppressed: 0, failed: 0 },
    });

    await call(requestDriverInputHandler, 'POST', { body: validBody({ actorUserId: 'attacker', staffId: 'attacker-staff' }) });

    const forwardedScope = mocks.requestDriverInput.mock.calls[0][1];
    expect(forwardedScope).toEqual({ userId: USER, staffId: STAFF, role: 'manager' });
  });

  it('maps validation, forbidden, not-found, and conflict errors to their status codes', async () => {
    mocks.requestDriverInput.mockRejectedValue(new DriverInputRequestValidationError('bad idempotencyKey'));
    expect((await call(requestDriverInputHandler, 'POST', { body: validBody() })).status).toBe(400);

    mocks.requestDriverInput.mockRejectedValue(new DriverInputAccessDeniedError('denied'));
    expect((await call(requestDriverInputHandler, 'POST', { body: validBody() })).status).toBe(403);

    mocks.requestDriverInput.mockRejectedValue(new IncidentNotFoundError('missing'));
    expect((await call(requestDriverInputHandler, 'POST', { body: validBody() })).status).toBe(404);

    mocks.requestDriverInput.mockRejectedValue(new DriverInputRequestConflictError('closed'));
    expect((await call(requestDriverInputHandler, 'POST', { body: validBody() })).status).toBe(409);
  });

  it('maps an unexpected error to 500 without leaking a fake success', async () => {
    mocks.requestDriverInput.mockRejectedValue(new Error('db exploded'));
    const result = await call(requestDriverInputHandler, 'POST', { body: validBody() });
    expect(result.status).toBe(500);
  });
});
