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

const driverIncidentService = vi.hoisted(() => ({
  listDriverIncidents: vi.fn(),
  getDriverIncident: vi.fn(),
  DriverIncidentValidationError: class DriverIncidentValidationError extends Error {
    constructor(message: string) { super(message); this.name = 'DriverIncidentValidationError'; }
  },
}));
vi.mock('@/modules/fleet/incidents/driver/driverIncidentService', () => driverIncidentService);

import listHandler from '../index';
import detailHandler from '../[incidentId]/index';

function mockRes() {
  const res = {
    statusCode: 0, body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; }, end() { return this; },
  };
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}
function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, req: Partial<NextApiRequest>) {
  const res = mockRes();
  return Promise.resolve(handler(req as NextApiRequest, res)).then(() => res);
}

const listResponse = { incidents: [], total: 0, recentWindowDays: 90, historyWindowDays: 365 };
const detailResponse = {
  id: INCIDENT, incidentReference: 'INC-LATE-20260810-ABC123', neutralLabel: 'Attendance timing needs review',
  projectLabel: 'Corridor A', siteLabel: 'Site 4', detectedAt: '2026-08-10T08:00:00.000Z', conditionState: 'active',
  lifecyclePresentation: 'Open', driverInputState: 'requested', currentRequest: null, respondedAt: null,
  explanationSummary: null, timeline: [], ownSubmissions: [], ownCorrectionLinks: [],
  responseEligible: true, responseIneligibleReason: null, enabledConcernCategories: ['other'],
};

beforeEach(() => {
  vi.clearAllMocks();
  currentSession = SESSION;
  driverIncidentService.listDriverIncidents.mockResolvedValue(listResponse);
  driverIncidentService.getDriverIncident.mockResolvedValue(detailResponse);
});

describe('GET /api/my/fleet/incidents', () => {
  it('rejects a non-GET method', async () => {
    const res = await call(listHandler, { method: 'POST', query: {} });
    expect(res.statusCode).toBe(405);
  });

  it('returns the scoped list on success', async () => {
    const res = await call(listHandler, { method: 'GET', query: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: listResponse });
  });

  it('always passes session.staffId as the scope, never a query-string staffId', async () => {
    await call(listHandler, { method: 'GET', query: { staffId: OTHER_SESSION.staffId } as never });

    expect(driverIncidentService.listDriverIncidents).toHaveBeenCalledWith(SESSION.staffId, expect.any(Object));
    const filters = driverIncidentService.listDriverIncidents.mock.calls[0]![1];
    expect(filters).not.toHaveProperty('staffId');
  });

  it('a driver cannot widen scope to another staff id even when the query string explicitly asks for one — the response is scoped to the session regardless', async () => {
    currentSession = OTHER_SESSION;

    await call(listHandler, { method: 'GET', query: { staffId: SESSION.staffId } as never });

    expect(driverIncidentService.listDriverIncidents).toHaveBeenCalledWith(OTHER_SESSION.staffId, expect.any(Object));
  });

  it('parses history/fromDate/toDate/limit/offset from the query string', async () => {
    await call(listHandler, { method: 'GET', query: { history: 'true', fromDate: '2026-01-01', toDate: '2026-02-01', limit: '10', offset: '5' } });

    expect(driverIncidentService.listDriverIncidents).toHaveBeenCalledWith(SESSION.staffId, {
      history: true, fromDate: '2026-01-01', toDate: '2026-02-01', limit: 10, offset: 5,
    });
  });

  it('400s on a non-numeric limit', async () => {
    const res = await call(listHandler, { method: 'GET', query: { limit: 'abc' } });
    expect(res.statusCode).toBe(400);
    expect(driverIncidentService.listDriverIncidents).not.toHaveBeenCalled();
  });

  it('maps a DriverIncidentValidationError to 400', async () => {
    driverIncidentService.listDriverIncidents.mockRejectedValue(new driverIncidentService.DriverIncidentValidationError('bad filter'));

    const res = await call(listHandler, { method: 'GET', query: {} });
    expect(res.statusCode).toBe(400);
  });

  it('maps an unexpected error to 500', async () => {
    driverIncidentService.listDriverIncidents.mockRejectedValue(new Error('db down'));

    const res = await call(listHandler, { method: 'GET', query: {} });
    expect(res.statusCode).toBe(500);
  });
});

describe('GET /api/my/fleet/incidents/[incidentId]', () => {
  it('rejects a non-GET method', async () => {
    const res = await call(detailHandler, { method: 'DELETE', query: { incidentId: INCIDENT } });
    expect(res.statusCode).toBe(405);
  });

  it('returns the scoped detail on success', async () => {
    const res = await call(detailHandler, { method: 'GET', query: { incidentId: INCIDENT } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: detailResponse });
  });

  it('always passes session.staffId, never a body/query staffId', async () => {
    await call(detailHandler, { method: 'GET', query: { incidentId: INCIDENT, staffId: OTHER_SESSION.staffId } as never });

    expect(driverIncidentService.getDriverIncident).toHaveBeenCalledWith(SESSION.staffId, INCIDENT);
  });

  it('404s when the service reports null — the same shape as a missing incident id, including when the incidentId belongs to another driver', async () => {
    driverIncidentService.getDriverIncident.mockResolvedValue(null);

    const res = await call(detailHandler, { method: 'GET', query: { incidentId: INCIDENT } });

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false });
  });

  it('a driver cannot reach another driver\'s incident even by asking for the exact same incidentId under a different session', async () => {
    driverIncidentService.getDriverIncident.mockImplementation(async (staffId: string) => (staffId === SESSION.staffId ? detailResponse : null));
    currentSession = OTHER_SESSION;

    const res = await call(detailHandler, { method: 'GET', query: { incidentId: INCIDENT } });

    expect(res.statusCode).toBe(404);
    expect(driverIncidentService.getDriverIncident).toHaveBeenCalledWith(OTHER_SESSION.staffId, INCIDENT);
  });

  it('never leaks incidentType/severity/raw internal fields in the JSON body', async () => {
    const res = await call(detailHandler, { method: 'GET', query: { incidentId: INCIDENT } });

    expect(JSON.stringify(res.body)).not.toMatch(/incidentType|severity|theft_after_hours_movement|accident_sos|recipient|coordinate/i);
  });

  it('400s when incidentId is missing from the route', async () => {
    const res = await call(detailHandler, { method: 'GET', query: {} });
    expect(res.statusCode).toBe(400);
    expect(driverIncidentService.getDriverIncident).not.toHaveBeenCalled();
  });

  it('maps an unexpected error to 500', async () => {
    driverIncidentService.getDriverIncident.mockRejectedValue(new Error('db down'));

    const res = await call(detailHandler, { method: 'GET', query: { incidentId: INCIDENT } });
    expect(res.statusCode).toBe(500);
  });
});
