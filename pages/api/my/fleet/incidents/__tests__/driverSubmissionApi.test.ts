import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const SESSION = { staffId: '11111111-1111-4111-8111-111111111111', staffName: 'A Driver' };
const OTHER_SESSION = { staffId: '99999999-9999-4999-8999-999999999999', staffName: 'Other Driver' };
const INCIDENT = '22222222-2222-4222-8222-222222222222';

let currentSession: typeof SESSION = SESSION;
vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (handler: (req: NextApiRequest, res: NextApiResponse, s: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(req, res, currentSession),
}));

const incidentRepository = vi.hoisted(() => ({
  IncidentNotFoundError: class IncidentNotFoundError extends Error {
    constructor(message: string) { super(message); this.name = 'IncidentNotFoundError'; }
  },
}));
vi.mock('@/modules/fleet/incidents/incidentRepository', () => incidentRepository);

const submissionService = vi.hoisted(() => ({
  submitDriverResponse: vi.fn(),
  DriverSubmissionValidationError: class DriverSubmissionValidationError extends Error {
    constructor(message: string) { super(message); this.name = 'DriverSubmissionValidationError'; }
  },
  DriverSubmissionNotEligibleError: class DriverSubmissionNotEligibleError extends Error {
    reason: string;
    constructor(reason: string) { super(`not eligible: ${reason}`); this.name = 'DriverSubmissionNotEligibleError'; this.reason = reason; }
  },
}));
vi.mock('@/modules/fleet/incidents/driver/submissionService', () => submissionService);

import handler from '../[incidentId]/submissions';

function mockRes() {
  const res = {
    statusCode: 0, body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; }, end() { return this; },
  };
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}
function call(req: Partial<NextApiRequest>) {
  const res = mockRes();
  return Promise.resolve(handler(req as NextApiRequest, res)).then(() => res);
}

const GOOD_BODY = { submissionKind: 'response', explanation: 'I was on site', concernCategory: null, idempotencyKey: 'key-1' };
const submissionResult = { submissionId: '55555555-5555-4555-8555-555555555555', incidentId: INCIDENT, driverInputState: 'responded', created: true };

beforeEach(() => {
  vi.clearAllMocks();
  currentSession = SESSION;
  submissionService.submitDriverResponse.mockResolvedValue(submissionResult);
});

describe('POST /api/my/fleet/incidents/[incidentId]/submissions', () => {
  it('rejects a non-POST method', async () => {
    const res = await call({ method: 'GET', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(405);
    expect(submissionService.submitDriverResponse).not.toHaveBeenCalled();
  });

  it('400s when incidentId is missing from the route', async () => {
    const res = await call({ method: 'POST', query: {}, body: GOOD_BODY });
    expect(res.statusCode).toBe(400);
    expect(submissionService.submitDriverResponse).not.toHaveBeenCalled();
  });

  it('accepts a well-formed submission and returns 200 with the result', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: submissionResult });
  });

  it('always submits as session.staffId, never a body-supplied staff/driver id', async () => {
    await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, staffId: OTHER_SESSION.staffId, driverStaffId: OTHER_SESSION.staffId } });

    expect(submissionService.submitDriverResponse).toHaveBeenCalledWith(expect.any(Object), SESSION.staffId);
  });

  it('a driver cannot submit as another driver even when the body explicitly names one — the session identity always wins', async () => {
    currentSession = OTHER_SESSION;

    await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, staffId: SESSION.staffId } });

    expect(submissionService.submitDriverResponse).toHaveBeenCalledWith(expect.any(Object), OTHER_SESSION.staffId);
  });

  it('the command passed to the service never carries a staffId field, even if the body smuggled one in', async () => {
    await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, staffId: OTHER_SESSION.staffId } });

    const command = submissionService.submitDriverResponse.mock.calls[0]![0];
    expect(command).not.toHaveProperty('staffId');
  });

  it('rejects a missing body', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: undefined });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unrecognized submissionKind', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, submissionKind: 'note' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-string explanation', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, explanation: 42 } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing idempotencyKey', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, idempotencyKey: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('maps a DriverSubmissionValidationError from the service to 400', async () => {
    submissionService.submitDriverResponse.mockRejectedValue(new submissionService.DriverSubmissionValidationError('explanation too long'));

    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(400);
  });

  it('maps IncidentNotFoundError to 404 (same shape whether missing or owned by another driver)', async () => {
    submissionService.submitDriverResponse.mockRejectedValue(new incidentRepository.IncidentNotFoundError('not found'));

    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(404);
  });

  it('maps DriverSubmissionNotEligibleError to 409 with the reason in the response details', async () => {
    submissionService.submitDriverResponse.mockRejectedValue(new submissionService.DriverSubmissionNotEligibleError('closed'));

    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: { details: { reason: 'closed' } } });
  });

  it('maps an unexpected error to 500', async () => {
    submissionService.submitDriverResponse.mockRejectedValue(new Error('db down'));

    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(500);
  });
});
