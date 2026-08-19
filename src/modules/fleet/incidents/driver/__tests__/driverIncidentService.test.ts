import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne }));

const repo = vi.hoisted(() => ({
  findDriverIncidents: vi.fn(), findDriverIncidentDetail: vi.fn(), listVisibleTimeline: vi.fn(),
}));
vi.mock('../driverInputRepository', () => repo);

const settingsRepo = vi.hoisted(() => ({ getEffectiveDriverInputSettings: vi.fn() }));
vi.mock('../settingsRepository', () => settingsRepo);

import {
  DriverIncidentValidationError, computeResponseEligibility, getDriverIncident, listDriverIncidents,
} from '../driverIncidentService';

const STAFF = '11111111-1111-4111-8111-111111111111';
const OTHER_STAFF = '99999999-9999-4999-8999-999999999999';
const INCIDENT = '22222222-2222-4222-8222-222222222222';

const settingsRow = {
  version: 1, effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  responseWindowWorkdays: 2, postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
  recentWindowDays: 90, historyWindowDays: 365,
  enabledConcernCategories: ['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'],
  evidenceAllowedMimeTypes: ['image/jpeg'], evidenceMaxBytes: 15728640,
  driverInputRequestedChannels: { inApp: true, email: true, whatsapp: false },
  driverResponseReceivedChannels: { inApp: true, email: true, whatsapp: false },
};

const listResponse = { incidents: [], total: 0, recentWindowDays: 90, historyWindowDays: 365 };

const detailItem = {
  id: INCIDENT, incidentReference: 'INC-LATE-20260810-ABC123', neutralLabel: 'Attendance timing needs review',
  projectLabel: 'Corridor A', siteLabel: 'Site 4', detectedAt: '2026-08-10T08:00:00.000Z', conditionState: 'active',
  lifecyclePresentation: 'Open', driverInputState: 'requested',
  currentRequest: { id: 'req-1', guidance: null, requestedAt: '2026-08-10T08:00:00.000Z', respondBy: '2099-08-12T21:59:59.999Z' },
  respondedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  settingsRepo.getEffectiveDriverInputSettings.mockResolvedValue(settingsRow);
  repo.findDriverIncidents.mockResolvedValue(listResponse);
  repo.findDriverIncidentDetail.mockResolvedValue(detailItem);
  repo.listVisibleTimeline.mockResolvedValue([]);
  db.query.mockResolvedValue([]);
  db.queryOne.mockResolvedValue(null);
});

describe('computeResponseEligibility', () => {
  const now = '2026-08-15T00:00:00.000Z';

  it('is eligible when the incident is active and there is no current request', () => {
    const result = computeResponseEligibility({
      now, currentRequest: null, incidentTerminalAt: null, postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    });
    expect(result).toEqual({ eligible: true, reason: null });
  });

  it('is eligible when the incident is active and the request is still within its window', () => {
    const result = computeResponseEligibility({
      now, currentRequest: { respondBy: '2026-08-16T00:00:00.000Z' }, incidentTerminalAt: null,
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    });
    expect(result).toEqual({ eligible: true, reason: null });
  });

  it('reports "expired" when the active incident\'s request respondBy has passed', () => {
    const result = computeResponseEligibility({
      now, currentRequest: { respondBy: '2026-08-14T00:00:00.000Z' }, incidentTerminalAt: null,
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    });
    expect(result).toEqual({ eligible: false, reason: 'expired' });
  });

  it('reports "closed" when the incident is terminal and post-closure response is disabled', () => {
    const result = computeResponseEligibility({
      now, currentRequest: null, incidentTerminalAt: '2026-08-10T00:00:00.000Z',
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    });
    expect(result).toEqual({ eligible: false, reason: 'closed' });
  });

  it('is eligible when the incident is terminal but still within an enabled post-closure window', () => {
    const result = computeResponseEligibility({
      now, currentRequest: null, incidentTerminalAt: '2026-08-14T00:00:00.000Z',
      postClosureResponseEnabled: true, postClosureResponseWindowDays: 5,
    });
    expect(result).toEqual({ eligible: true, reason: null });
  });

  it('reports "outside_window" when the terminal incident\'s post-closure window has elapsed', () => {
    const result = computeResponseEligibility({
      now, currentRequest: null, incidentTerminalAt: '2026-08-01T00:00:00.000Z',
      postClosureResponseEnabled: true, postClosureResponseWindowDays: 5,
    });
    expect(result).toEqual({ eligible: false, reason: 'outside_window' });
  });

  it('a terminal incident overrides an active-looking expired-request check (terminal branch wins)', () => {
    const result = computeResponseEligibility({
      now, currentRequest: { respondBy: '2026-08-14T00:00:00.000Z' }, incidentTerminalAt: '2026-08-10T00:00:00.000Z',
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    });
    expect(result.reason).toBe('closed');
  });
});

describe('listDriverIncidents — scoping and validation', () => {
  it('passes sessionStaffId straight through to the scoped repository call', async () => {
    await listDriverIncidents(STAFF, {});

    expect(repo.findDriverIncidents).toHaveBeenCalledWith(STAFF, expect.any(Object));
  });

  it('ignores any staffId-shaped field smuggled into filters — the type has none, but defensively confirm the call site never adds one', async () => {
    await listDriverIncidents(STAFF, { ...( { staffId: OTHER_STAFF } as Record<string, unknown>) });

    expect(repo.findDriverIncidents).toHaveBeenCalledWith(STAFF, expect.not.objectContaining({ staffId: expect.anything() }));
  });

  it('defaults history to false and uses the recent window', async () => {
    await listDriverIncidents(STAFF, {});

    const params = repo.findDriverIncidents.mock.calls[0]![1];
    expect(params.terminalWindowDays).toBe(90);
  });

  it('uses the history window when history=true', async () => {
    await listDriverIncidents(STAFF, { history: true });

    const params = repo.findDriverIncidents.mock.calls[0]![1];
    expect(params.terminalWindowDays).toBe(365);
  });

  it('rejects a history=true fromDate older than the configured history window', async () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await expect(listDriverIncidents(STAFF, { history: true, fromDate: old })).rejects.toBeInstanceOf(DriverIncidentValidationError);
    expect(repo.findDriverIncidents).not.toHaveBeenCalled();
  });

  it('accepts a history=true fromDate within the configured history window', async () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await expect(listDriverIncidents(STAFF, { history: true, fromDate: recent })).resolves.toBeDefined();
  });

  it('rejects a malformed fromDate', async () => {
    await expect(listDriverIncidents(STAFF, { fromDate: 'not-a-date' })).rejects.toBeInstanceOf(DriverIncidentValidationError);
  });

  it('rejects a limit above the maximum', async () => {
    await expect(listDriverIncidents(STAFF, { limit: 1000 })).rejects.toBeInstanceOf(DriverIncidentValidationError);
  });

  it('rejects a negative offset', async () => {
    await expect(listDriverIncidents(STAFF, { offset: -1 })).rejects.toBeInstanceOf(DriverIncidentValidationError);
  });
});

describe('getDriverIncident — IDOR safety and redaction', () => {
  it('returns null (not an error) when the repository finds no row for this staff/incident pair', async () => {
    repo.findDriverIncidentDetail.mockResolvedValue(null);

    await expect(getDriverIncident(OTHER_STAFF, INCIDENT)).resolves.toBeNull();
  });

  it('a driver cannot reach another driver\'s incident even though the id is real and well-formed: the scoped repository call is what decides, and returns null exactly as for a missing id', async () => {
    // The repository itself enforces `staff_id = $1`; simulate the real
    // outcome for a non-owning staff id — no row — and confirm the service
    // does not paper over that with its own fallback lookup by incident id alone.
    repo.findDriverIncidentDetail.mockImplementation(async (staffId: string) => (staffId === STAFF ? detailItem : null));

    const ownResult = await getDriverIncident(STAFF, INCIDENT);
    const otherResult = await getDriverIncident(OTHER_STAFF, INCIDENT);

    expect(ownResult).not.toBeNull();
    expect(otherResult).toBeNull();
    expect(repo.findDriverIncidentDetail).toHaveBeenCalledWith(OTHER_STAFF, INCIDENT, expect.any(Object));
  });

  it('returns null for a malformed incident id without ever querying the repository', async () => {
    await expect(getDriverIncident(STAFF, 'not-a-uuid')).resolves.toBeNull();
    expect(repo.findDriverIncidentDetail).not.toHaveBeenCalled();
  });

  it('never includes incidentType or severity on the returned object, at any key', async () => {
    const result = await getDriverIncident(STAFF, INCIDENT);

    expect(result).not.toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/incidentType|severity|theft_after_hours_movement|accident_sos/);
  });

  it('sets explanationSummary to null (no safe generator exists yet)', async () => {
    const result = await getDriverIncident(STAFF, INCIDENT);

    expect(result?.explanationSummary).toBeNull();
  });

  it('includes enabledConcernCategories from the effective settings', async () => {
    const result = await getDriverIncident(STAFF, INCIDENT);

    expect(result?.enabledConcernCategories).toEqual(settingsRow.enabledConcernCategories);
  });

  it('scopes the own-submissions and own-correction-links reads by staff_id, not incident id alone', async () => {
    await getDriverIncident(STAFF, INCIDENT);

    const submissionsCall = db.query.mock.calls.find(([text]: [string]) => text.includes('fleet_incident_driver_submissions'));
    expect(submissionsCall?.[1]).toEqual([INCIDENT, STAFF]);
    const linksCall = db.query.mock.calls.find(([text]: [string]) => text.includes('fleet_incident_attendance_correction_links'));
    expect(linksCall?.[1]).toEqual([INCIDENT, STAFF]);
  });

  it('marks a request-expired, still-active incident ineligible with reason "expired"', async () => {
    repo.findDriverIncidentDetail.mockResolvedValue({
      ...detailItem, currentRequest: { id: 'req-1', guidance: null, requestedAt: '2020-01-01T00:00:00.000Z', respondBy: '2020-01-02T00:00:00.000Z' },
    });
    db.queryOne.mockResolvedValue({ resolved_at: null });

    const result = await getDriverIncident(STAFF, INCIDENT);

    expect(result?.responseEligible).toBe(false);
    expect(result?.responseIneligibleReason).toBe('expired');
  });

  it('marks a resolved incident (no post-closure) ineligible with reason "closed"', async () => {
    db.queryOne.mockResolvedValue({ resolved_at: '2026-08-01T00:00:00.000Z' });

    const result = await getDriverIncident(STAFF, INCIDENT);

    expect(result?.responseEligible).toBe(false);
    expect(result?.responseIneligibleReason).toBe('closed');
  });
});
