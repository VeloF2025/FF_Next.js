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

const vfStorageUpload = vi.hoisted(() => ({
  VfStorageValidationError: class VfStorageValidationError extends Error {
    constructor(message: string) { super(message); this.name = 'VfStorageValidationError'; }
  },
  VfStorageOriginError: class VfStorageOriginError extends Error {
    constructor(message: string) { super(message); this.name = 'VfStorageOriginError'; }
  },
}));
vi.mock('@/lib/vfStorageUpload', () => vfStorageUpload);

const driverEvidenceService = vi.hoisted(() => ({
  uploadDriverIncidentEvidence: vi.fn(),
  DriverEvidenceValidationError: class DriverEvidenceValidationError extends Error {
    constructor(message: string) { super(message); this.name = 'DriverEvidenceValidationError'; }
  },
  DriverEvidenceNotEligibleError: class DriverEvidenceNotEligibleError extends Error {
    reason: string;
    constructor(reason: string) { super(`not eligible: ${reason}`); this.name = 'DriverEvidenceNotEligibleError'; this.reason = reason; }
  },
  DriverEvidenceOrphanError: class DriverEvidenceOrphanError extends Error {
    storageKey: string; storageUrl: string;
    constructor(message: string, storageKey: string, storageUrl: string) {
      super(message); this.name = 'DriverEvidenceOrphanError'; this.storageKey = storageKey; this.storageUrl = storageUrl;
    }
  },
}));
vi.mock('@/modules/fleet/incidents/driver/driverEvidenceService', () => driverEvidenceService);

import handler from '../[incidentId]/evidence';

function mockRes() {
  const res = {
    statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
    end() { return this; },
  };
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown; headers: Record<string, string> };
}
function call(req: Partial<NextApiRequest>) {
  const res = mockRes();
  return Promise.resolve(handler(req as NextApiRequest, res)).then(() => res);
}

const GOOD_BODY = { mimeType: 'image/jpeg', base64: 'aW1hZ2U=', filename: 'evidence.jpg', description: null };
const uploadResult = { evidenceId: '55555555-5555-4555-8555-555555555555', incidentId: INCIDENT, storageUrl: '/storage/fleet/incidents/key.jpg' };

beforeEach(() => {
  vi.clearAllMocks();
  currentSession = SESSION;
  driverEvidenceService.uploadDriverIncidentEvidence.mockResolvedValue(uploadResult);
});

describe('POST /api/my/fleet/incidents/[incidentId]/evidence', () => {
  it('rejects a non-POST method (no delete/update route exists)', async () => {
    const res = await call({ method: 'DELETE', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(405);
    expect(driverEvidenceService.uploadDriverIncidentEvidence).not.toHaveBeenCalled();
  });

  it('rejects GET too', async () => {
    const res = await call({ method: 'GET', query: { incidentId: INCIDENT } });
    expect(res.statusCode).toBe(405);
  });

  it('400s when incidentId is missing from the route', async () => {
    const res = await call({ method: 'POST', query: {}, body: GOOD_BODY });
    expect(res.statusCode).toBe(400);
    expect(driverEvidenceService.uploadDriverIncidentEvidence).not.toHaveBeenCalled();
  });

  it('accepts a well-formed evidence upload and returns success with the result', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect([200, 201]).toContain(res.statusCode);
    expect(res.body).toMatchObject({ success: true, data: uploadResult });
  });

  it('always uploads as session.staffId, never a body-supplied staff/driver id', async () => {
    await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, staffId: OTHER_SESSION.staffId } });
    expect(driverEvidenceService.uploadDriverIncidentEvidence).toHaveBeenCalledWith(expect.any(Object), SESSION.staffId);
  });

  it('a driver cannot upload as another driver even when the body explicitly names one — the session identity always wins', async () => {
    currentSession = OTHER_SESSION;
    await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, staffId: SESSION.staffId } });
    expect(driverEvidenceService.uploadDriverIncidentEvidence).toHaveBeenCalledWith(expect.any(Object), OTHER_SESSION.staffId);
  });

  it('the command passed to the service never carries a staffId field, even if the body smuggled one in', async () => {
    await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, staffId: OTHER_SESSION.staffId } });
    const command = driverEvidenceService.uploadDriverIncidentEvidence.mock.calls[0]![0];
    expect(command).not.toHaveProperty('staffId');
  });

  it('rejects a missing body', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: undefined });
    expect(res.statusCode).toBe(400);
    expect(driverEvidenceService.uploadDriverIncidentEvidence).not.toHaveBeenCalled();
  });

  it('rejects a non-string mimeType', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, mimeType: 42 } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing base64', async () => {
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: { ...GOOD_BODY, base64: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('never forwards base64 content anywhere but the parsed command', async () => {
    await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    const forwarded = driverEvidenceService.uploadDriverIncidentEvidence.mock.calls[0][0];
    expect(forwarded.base64).toBe('aW1hZ2U=');
  });

  it('maps a DriverEvidenceValidationError from the service to 400', async () => {
    driverEvidenceService.uploadDriverIncidentEvidence.mockRejectedValue(new driverEvidenceService.DriverEvidenceValidationError('bad mimeType'));
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(400);
  });

  it('maps a VfStorageValidationError from the service to 400', async () => {
    driverEvidenceService.uploadDriverIncidentEvidence.mockRejectedValue(new vfStorageUpload.VfStorageValidationError('MIME not allowed'));
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(400);
  });

  it('maps IncidentNotFoundError to 404 (same shape whether missing or owned by another driver)', async () => {
    driverEvidenceService.uploadDriverIncidentEvidence.mockRejectedValue(new incidentRepository.IncidentNotFoundError('not found'));
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(404);
  });

  it('maps DriverEvidenceNotEligibleError to 409 with the reason in the response details', async () => {
    driverEvidenceService.uploadDriverIncidentEvidence.mockRejectedValue(new driverEvidenceService.DriverEvidenceNotEligibleError('closed'));
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: { details: { reason: 'closed' } } });
  });

  it('maps a non-approved storage origin to 500 without leaking a fake success', async () => {
    driverEvidenceService.uploadDriverIncidentEvidence.mockRejectedValue(new vfStorageUpload.VfStorageOriginError('unapproved origin'));
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatchObject({ success: true });
  });

  it('maps a DriverEvidenceOrphanError to 500 without leaking a fake success', async () => {
    driverEvidenceService.uploadDriverIncidentEvidence.mockRejectedValue(
      new driverEvidenceService.DriverEvidenceOrphanError('orphaned', 'fleet/incidents/key.jpg', '/storage/fleet/incidents/key.jpg'),
    );
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatchObject({ success: true });
  });

  it('maps an unexpected error to 500', async () => {
    driverEvidenceService.uploadDriverIncidentEvidence.mockRejectedValue(new Error('db down'));
    const res = await call({ method: 'POST', query: { incidentId: INCIDENT }, body: GOOD_BODY });
    expect(res.statusCode).toBe(500);
  });
});
