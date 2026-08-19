import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const SESSION = { staffId: '11111111-1111-4111-8111-111111111111', staffName: 'A Driver' };
const OTHER_SESSION = { staffId: '99999999-9999-4999-8999-999999999999', staffName: 'Other Driver' };
const INCIDENT = '22222222-2222-4222-8222-222222222222';
const CORRECTION = '55555555-5555-4555-8555-555555555555';

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

const service = vi.hoisted(() => ({
  getAttendanceCorrectionEligibility: vi.fn(),
  linkAttendanceCorrection: vi.fn(),
  AttendanceCorrectionLinkValidationError: class AttendanceCorrectionLinkValidationError extends Error {
    constructor(message: string) { super(message); this.name = 'AttendanceCorrectionLinkValidationError'; }
  },
  AttendanceCorrectionNotFoundError: class AttendanceCorrectionNotFoundError extends Error {
    attendanceCorrectionId: string;
    constructor(attendanceCorrectionId: string) {
      super('Attendance correction not found for this driver and incident');
      this.name = 'AttendanceCorrectionNotFoundError';
      this.attendanceCorrectionId = attendanceCorrectionId;
    }
  },
}));
vi.mock('@/modules/fleet/incidents/driver/attendanceCorrectionLinkService', () => service);

import handler from '../[incidentId]/attendance-correction-link';

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

const eligibleResult = { eligible: true, exceptionId: 'exc-1', entryId: 'entry-1' };
const linkResult = { linkId: 'link-1', incidentId: INCIDENT, attendanceCorrectionId: CORRECTION, correctionState: 'pending' };

beforeEach(() => {
  vi.clearAllMocks();
  currentSession = SESSION;
  service.getAttendanceCorrectionEligibility.mockResolvedValue(eligibleResult);
  service.linkAttendanceCorrection.mockResolvedValue(linkResult);
});

describe('GET /api/my/fleet/incidents/[incidentId]/attendance-correction-link', () => {
  it('400s when incidentId is missing from the route', async () => {
    const res = await call({ method: 'GET', query: {} });
    expect(res.statusCode).toBe(400);
    expect(service.getAttendanceCorrectionEligibility).not.toHaveBeenCalled();
  });

  it('returns 200 with the eligibility result, scoped to session.staffId', async () => {
    const res = await call({ method: 'GET', query: { incidentId: INCIDENT } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: eligibleResult });
    expect(service.getAttendanceCorrectionEligibility).toHaveBeenCalledWith(INCIDENT, SESSION.staffId);
  });

  it('a driver cannot read another staff member\'s eligibility even by naming the incident directly — the session identity always wins', async () => {
    currentSession = OTHER_SESSION;
    await call({ method: 'GET', query: { incidentId: INCIDENT } });
    expect(service.getAttendanceCorrectionEligibility).toHaveBeenCalledWith(INCIDENT, OTHER_SESSION.staffId);
  });

  it('404s when the incident does not exist or is not owned by this driver', async () => {
    service.getAttendanceCorrectionEligibility.mockRejectedValue(new incidentRepository.IncidentNotFoundError('nope'));
    const res = await call({ method: 'GET', query: { incidentId: INCIDENT } });
    expect(res.statusCode).toBe(404);
  });

  it('400s on a validation error from the service', async () => {
    service.getAttendanceCorrectionEligibility.mockRejectedValue(new service.AttendanceCorrectionLinkValidationError('bad id'));
    const res = await call({ method: 'GET', query: { incidentId: 'not-a-uuid' } });
    expect(res.statusCode).toBe(400);
  });
});

const GOOD_BODY = { attendanceCorrectionId: CORRECTION };

describe('POST /api/my/fleet/incidents/[incidentId]/attendance-correction-link', () => {
  it('400s when incidentId is missing from the route', async () => {
    const res = await call({ method: 'POST', query: {}, body: GOOD_BODY });
    expect(res.statusCode).toBe(400);
    expect(service.linkAttendanceCorrection).not.toHaveBeenCalled();
  });

  it('rejects a missing body', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: undefined });
    expect(res.statusCode).toBe(400);
    expect(service.linkAttendanceCorrection).not.toHaveBeenCalled();
  });

  it('rejects a missing attendanceCorrectionId', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: {} });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a well-formed link request and returns 200 with the result', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: linkResult });
  });

  it('always links as session.staffId, never a body-supplied staff/driver id', async () => {
    await call({
      method: 'POST', query: { incidentId: INCIDENT },
      body: { ...GOOD_BODY, staffId: OTHER_SESSION.staffId, driverStaffId: OTHER_SESSION.staffId },
    });

    expect(service.linkAttendanceCorrection).toHaveBeenCalledWith(expect.any(Object), SESSION.staffId);
    const command = service.linkAttendanceCorrection.mock.calls[0]![0];
    expect(command).not.toHaveProperty('staffId');
  });

  it('a driver cannot link as another driver even when the body explicitly names one — the session identity always wins', async () => {
    currentSession = OTHER_SESSION;
    await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, staffId: SESSION.staffId } });
    expect(service.linkAttendanceCorrection).toHaveBeenCalledWith(expect.any(Object), OTHER_SESSION.staffId);
  });

  it('passes an optional driverSubmissionId through to the service', async () => {
    await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, driverSubmissionId: 'sub-1' } });
    expect(service.linkAttendanceCorrection).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: INCIDENT, attendanceCorrectionId: CORRECTION, driverSubmissionId: 'sub-1' }),
      SESSION.staffId,
    );
  });

  it('404s when the incident does not exist or is not owned by this driver', async () => {
    service.linkAttendanceCorrection.mockRejectedValue(new incidentRepository.IncidentNotFoundError('nope'));
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(404);
  });

  it('404s when the named attendance correction is not this driver\'s own — never confirms it exists', async () => {
    service.linkAttendanceCorrection.mockRejectedValue(new service.AttendanceCorrectionNotFoundError(CORRECTION));
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(404);
  });

  it('400s on a validation error from the service', async () => {
    service.linkAttendanceCorrection.mockRejectedValue(new service.AttendanceCorrectionLinkValidationError('bad id'));
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { attendanceCorrectionId: 'not-a-uuid' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('unsupported methods', () => {
  it('405s for DELETE', async () => {
    const res = await call({ method: 'DELETE', query: { incidentId: INCIDENT } });
    expect(res.statusCode).toBe(405);
  });
});
