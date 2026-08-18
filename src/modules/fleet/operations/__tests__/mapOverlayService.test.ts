import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalEvidence, OperationalStatusSummary } from '../types';

const mocks = vi.hoisted(() => ({
  roster: vi.fn(), evidence: vi.fn(), detail: vi.fn(), query: vi.fn(), project: vi.fn(), oversight: vi.fn(),
}));
vi.mock('../statusService', async () => {
  const actual = await vi.importActual<typeof import('../statusService')>('../statusService');
  return { ...actual, getOperationalRosterStatus: mocks.roster, getOperationalEvidenceDetail: mocks.detail };
});
vi.mock('../evidenceQueries', () => ({ loadOperationalEvidence: mocks.evidence }));
vi.mock('../projectScope', () => ({
  canAccessOperationalProject: mocks.project,
  hasOperationalOversight: mocks.oversight,
}));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));

import { OperationalRosterTooLargeError } from '../completeRosterLoading';
import {
  getOperationalMapOverlay,
  OperationalMapAccessError,
  type OperationalMapOverlayRequest,
} from '../mapOverlayService';

const PROJECT = '33333333-3333-4333-8333-333333333333';
const SITE = '44444444-4444-4444-8444-444444444444';
const OTHER_SITE = '66666666-6666-4666-8666-666666666666';
const STAFF = '22222222-2222-4222-8222-222222222222';
const VEHICLE = '55555555-5555-4555-8555-555555555555';
const AS_OF = '2026-08-14T08:00:00.000Z';
const actor = { userId: '11111111-1111-4111-8111-111111111111', staffId: STAFF, role: 'manager' };
const request: OperationalMapOverlayRequest = {
  projectId: PROJECT, workDate: '2026-08-14', asOf: AS_OF, page: 1, limit: 25, includeGeometry: false,
};

function summary(values: Partial<OperationalStatusSummary> = {}): OperationalStatusSummary {
  return {
    staffId: STAFF, staffName: 'Driver One', projectId: PROJECT, projectName: 'Project One',
    operationalSiteId: SITE, operationalSiteName: 'Site One', status: 'attendance_confirmed', flags: [],
    reasonCodes: ['attendance_inside_required_site'], monitoringStart: '2026-08-14T05:00:00.000Z',
    scheduledStart: '2026-08-14T06:00:00.000Z', graceEnd: '2026-08-14T06:15:00.000Z',
    scheduledEnd: '2026-08-14T15:00:00.000Z', monitoringEnd: '2026-08-14T16:00:00.000Z',
    gpsStaleAfterSeconds: 300, sourceTimestamps: ['2026-08-14T06:01:00.000Z'], ruleId: 'rule-1',
    ruleVersion: 2, ...values,
  };
}

function evidence(values: Partial<OperationalEvidence> = {}): OperationalEvidence {
  return {
    asOf: AS_OF, workDate: '2026-08-14', staffId: STAFF, staffName: 'Driver One',
    assignment: { assignmentId: 'assignment-1', source: 'roster', projectId: PROJECT, projectName: 'Project One',
      operationalSiteId: SITE, operationalSiteName: 'Site One', ambiguous: false, siteGeometryValid: true,
      siteGeometryLowConfidence: false },
    schedule: { policyId: 'policy-1', workDate: '2026-08-14', timezone: 'Africa/Johannesburg', scheduled: true,
      explicitWork: false, startTime: '08:00:00', endTime: '17:00:00', graceMinutes: 15 },
    attendance: { entryId: 'entry-1', clockInAt: '2026-08-14T06:01:00.000Z', clockOutAt: null,
      clockInPoint: { latitude: -26.1, longitude: 28.1, recordedAt: '2026-08-14T06:01:00.000Z' },
      clockOutPoint: null, matchedSiteId: SITE, requiredSite: { valid: true, inside: true, distanceM: 0, knownSiteId: SITE } },
    vehicle: { assignmentId: 'vehicle-assignment-1', vehicleId: VEHICLE, provider: 'private-provider',
      accountRef: 'private-account', staleAfterSeconds: 300, positions: [{ latitude: -26.2, longitude: 28.2,
        recordedAt: '2026-08-14T07:59:00.000Z', valid: true, inside: true, distanceM: 0, speedKmh: 0,
        knownSiteId: SITE }] },
    rule: { id: 'rule-1', version: 2, timezone: 'Africa/Johannesburg', effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null, monitoringBeforeMinutes: 60, monitoringAfterMinutes: 60, arrivalDwellMinutes: 5,
      wrongSiteConfirmationMinutes: 5, earlyDepartureConfirmationMinutes: 10, approachingDistanceMeters: 10_000,
      approachingMinReadings: 2, minimumMovingSpeedKmh: 5, evidenceMismatchToleranceMeters: 250 },
    sourceWarnings: [], sourceErrors: [], ...values,
  };
}

function detail() {
  return { staffId: STAFF, workDate: '2026-08-14', projectName: 'Project One', operationalSiteName: 'Site One',
    monitoringStart: '2026-08-14T05:00:00.000Z', scheduledStart: '2026-08-14T06:00:00.000Z',
    graceEnd: '2026-08-14T06:15:00.000Z', scheduledEnd: '2026-08-14T15:00:00.000Z',
    monitoringEnd: '2026-08-14T16:00:00.000Z', gpsStaleAfterSeconds: 300,
    evaluation: { status: 'attendance_confirmed' as const, flags: [], reasonCodes: ['attendance_inside_required_site'],
      ruleId: 'rule-1', ruleVersion: 2, sourceTimestamps: ['2026-08-14T06:01:00.000Z'], thresholdsUsed: {} },
    points: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.mockResolvedValue(true); mocks.oversight.mockResolvedValue(false); mocks.query.mockResolvedValue([]);
  mocks.roster.mockResolvedValue({ items: [summary()], page: 1, limit: 100, total: 1, hasMore: false });
  mocks.evidence.mockResolvedValue({ items: [evidence()], total: 1 });
});

describe('getOperationalMapOverlay', () => {
  it('returns vehicle badge identity without raw coordinates, provider, account, or contact fields', async () => {
    const result = await getOperationalMapOverlay(request, actor);
    expect(result.badges).toEqual([expect.objectContaining({ vehicleId: VEHICLE, staffId: STAFF,
      status: 'attendance_confirmed', projectId: PROJECT, operationalSiteId: SITE })]);
    expect(result.attendancePoints).toEqual([]);
    const serialized = JSON.stringify(result);
    for (const forbidden of ['private-provider', 'private-account', 'email', 'phone', 'positions']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('uses one minimum Attendance point only for an unvehicled driver inside the monitoring window', async () => {
    mocks.evidence.mockResolvedValue({ items: [evidence({ vehicle: { assignmentId: null, vehicleId: null,
      provider: null, accountRef: null, staleAfterSeconds: null, positions: [] } })], total: 1 });
    const result = await getOperationalMapOverlay(request, actor);
    expect(result.badges).toEqual([]);
    expect(result.attendancePoints).toEqual([{ staffId: STAFF, staffName: 'Driver One', projectId: PROJECT,
      operationalSiteId: SITE, status: 'attendance_confirmed', latitude: -26.1, longitude: 28.1,
      recordedAt: '2026-08-14T06:01:00.000Z', source: 'attendance_clock_in', live: false,
      label: 'Attendance check-in evidence — not live tracking' }]);

    mocks.roster.mockResolvedValue({ items: [summary({ monitoringStart: '2026-08-14T07:00:00.000Z' })],
      page: 1, limit: 100, total: 1, hasMore: false });
    const outside = await getOperationalMapOverlay(request, actor);
    expect(outside.attendancePoints).toEqual([]);
    expect(outside.unplottable).toEqual([expect.objectContaining({ staffId: STAFF, reason: 'no_permissible_coordinate' })]);
  });

  it('withholds Attendance coordinates when asOf is after the PR4 monitoring window', async () => {
    const afterWindow = '2026-08-14T16:00:01.000Z';
    mocks.roster.mockResolvedValue({ items: [summary({ status: 'off_duty',
      reasonCodes: ['outside_monitoring_window'] })], page: 1, limit: 100, total: 1, hasMore: false });
    mocks.evidence.mockResolvedValue({ items: [evidence({ asOf: afterWindow, vehicle: { assignmentId: null,
      vehicleId: null, provider: null, accountRef: null, staleAfterSeconds: null, positions: [] } })], total: 1 });
    const result = await getOperationalMapOverlay({ ...request, asOf: afterWindow }, actor);
    expect(result.attendancePoints).toEqual([]);
    expect(result.unplottable).toEqual([expect.objectContaining({ staffId: STAFF, status: 'off_duty' })]);
  });

  it('keeps a no-evidence driver unplottable instead of fabricating an expected-site point', async () => {
    mocks.evidence.mockResolvedValue({ items: [evidence({ attendance: { entryId: null, clockInAt: null,
      clockOutAt: null, clockInPoint: null, clockOutPoint: null, matchedSiteId: null, requiredSite: null },
      vehicle: { assignmentId: null, vehicleId: null, provider: null, accountRef: null,
        staleAfterSeconds: null, positions: [] } })], total: 1 });
    const result = await getOperationalMapOverlay(request, actor);
    expect(result.attendancePoints).toEqual([]);
    expect(result.unplottable).toEqual([expect.objectContaining({ staffId: STAFF,
      operationalSiteId: SITE, reason: 'no_permissible_coordinate' })]);
    expect(JSON.stringify(result.unplottable)).not.toMatch(/latitude|longitude/);
  });

  it('loads only selected AOI GeoJSON and reports low confidence', async () => {
    mocks.query.mockResolvedValue([{ site_id: SITE, project_id: PROJECT, site_name: 'Site One', source: 'aoi',
      confidence: 'low', geojson: { type: 'MultiPolygon', coordinates: [[[[28, -26], [28.1, -26], [28, -26]]]] },
      latitude: null, longitude: null, radius_m: null }]);
    const result = await getOperationalMapOverlay({ ...request, siteId: SITE, includeGeometry: true }, actor);
    expect(result.geometry).toEqual(expect.objectContaining({ kind: 'aoi', operationalSiteId: SITE,
      confidence: 'low', lowConfidence: true, geoJson: expect.objectContaining({ type: 'MultiPolygon' }) }));
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain('ST_AsGeoJSON');
  });

  it('maps a selected Authorized Location as a circle and omits geometry when not requested', async () => {
    mocks.query.mockResolvedValue([{ site_id: SITE, project_id: PROJECT, site_name: 'Site One',
      source: 'authorized_location', confidence: null, geojson: null, latitude: '-26.1', longitude: '28.1',
      radius_m: '1500' }]);
    const selected = await getOperationalMapOverlay({ ...request, siteId: SITE, includeGeometry: true }, actor);
    expect(selected.geometry).toEqual({ kind: 'authorized_location', operationalSiteId: SITE, projectId: PROJECT,
      operationalSiteName: 'Site One', center: { latitude: -26.1, longitude: 28.1 }, radiusM: 1500 });

    mocks.query.mockClear();
    const omitted = await getOperationalMapOverlay(request, actor);
    expect(omitted.geometry).toBeUndefined(); expect(mocks.query).not.toHaveBeenCalled();
  });

  it('loads geometry from the authorized assignment for a staff-only oversight selection', async () => {
    mocks.oversight.mockResolvedValue(true);
    mocks.detail.mockResolvedValue(detail());
    mocks.query.mockResolvedValue([{ site_id: SITE, project_id: PROJECT, site_name: 'Site One', source: 'aoi',
      confidence: 'medium', geojson: { type: 'MultiPolygon', coordinates: [] }, latitude: null,
      longitude: null, radius_m: null }]);
    const result = await getOperationalMapOverlay({ ...request, projectId: undefined, staffId: STAFF,
      includeGeometry: true }, actor);
    expect(result.geometry).toEqual(expect.objectContaining({ kind: 'aoi', projectId: PROJECT,
      operationalSiteId: SITE }));
  });

  it('resolves a site-only selection to its project before authorization and loading', async () => {
    mocks.query.mockResolvedValueOnce([{ project_id: PROJECT }]).mockResolvedValueOnce([{ site_id: SITE,
      project_id: PROJECT, site_name: 'Site One', source: 'aoi', confidence: 'medium',
      geojson: { type: 'MultiPolygon', coordinates: [] }, latitude: null, longitude: null, radius_m: null }]);
    const result = await getOperationalMapOverlay({ ...request, projectId: undefined, siteId: SITE,
      includeGeometry: true }, actor);
    expect(mocks.project).toHaveBeenCalledWith(actor.userId, actor.staffId, actor.role, PROJECT);
    expect(mocks.roster).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT }));
    expect(result.geometry).toEqual(expect.objectContaining({ projectId: PROJECT, operationalSiteId: SITE }));
  });

  it('intersects staff and site selection instead of returning staff or geometry from a different site', async () => {
    mocks.oversight.mockResolvedValue(true); mocks.detail.mockResolvedValue(detail());
    mocks.query.mockResolvedValueOnce([{ project_id: PROJECT }]);
    const result = await getOperationalMapOverlay({ ...request, projectId: undefined, staffId: STAFF,
      siteId: OTHER_SITE, includeGeometry: true }, actor);
    expect(result).toMatchObject({ badges: [], attendancePoints: [], unplottable: [], total: 0 });
    expect(result.geometry).toBeUndefined(); expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain('selected-site-scope');
  });

  it('derives selected staff geometry before pagination hides the row', async () => {
    mocks.query.mockResolvedValue([{ site_id: SITE, project_id: PROJECT, site_name: 'Site One', source: 'aoi',
      confidence: 'medium', geojson: { type: 'MultiPolygon', coordinates: [] }, latitude: null,
      longitude: null, radius_m: null }]);
    const result = await getOperationalMapOverlay({ ...request, staffId: STAFF, page: 2, limit: 1,
      includeGeometry: true }, actor);
    expect(result.badges).toEqual([]); expect(result.geometry).toEqual(expect.objectContaining({ operationalSiteId: SITE }));
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([PROJECT, SITE]);
  });

  it('enforces project scope before loading data and preserves the historical asOf boundary', async () => {
    mocks.project.mockResolvedValue(false);
    await expect(getOperationalMapOverlay(request, actor)).rejects.toBeInstanceOf(OperationalMapAccessError);
    expect(mocks.roster).not.toHaveBeenCalled(); expect(mocks.evidence).not.toHaveBeenCalled();

    mocks.project.mockResolvedValue(true);
    await getOperationalMapOverlay({ ...request, asOf: '2026-08-13T12:34:56.000Z', workDate: '2026-08-13' }, actor);
    expect(mocks.roster).toHaveBeenLastCalledWith({ projectId: PROJECT, workDate: '2026-08-13',
      asOf: '2026-08-13T12:34:56.000Z', page: 1, limit: 100 });
    expect(mocks.evidence).toHaveBeenLastCalledWith({ projectId: PROJECT, workDate: '2026-08-13',
      asOf: '2026-08-13T12:34:56.000Z', limit: 100, offset: 0 });
  });

  it('completes a roster and evidence selection spanning more than 100 staff by paging both sources', async () => {
    mocks.roster.mockImplementation(async (req: { page: number }) => (req.page === 1
      ? { items: Array.from({ length: 100 }, (_, i) => summary({ staffId: `s-${i}` })), page: 1, limit: 100, total: 130, hasMore: true }
      : { items: Array.from({ length: 30 }, (_, i) => summary({ staffId: `s-${100 + i}` })), page: 2, limit: 100, total: 130, hasMore: false }));
    mocks.evidence.mockImplementation(async (req: { offset: number }) => (req.offset === 0
      ? { items: Array.from({ length: 100 }, (_, i) => evidence({ staffId: `s-${i}` })), total: 130 }
      : { items: Array.from({ length: 30 }, (_, i) => evidence({ staffId: `s-${100 + i}` })), total: 130 }));
    const result = await getOperationalMapOverlay({ ...request, page: 1, limit: 100 }, actor);
    expect(mocks.roster).toHaveBeenCalledTimes(2);
    expect(mocks.evidence).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(130);
  });

  it('rejects an operational selection whose roster exceeds the paging safety bound instead of looping forever', async () => {
    mocks.roster.mockResolvedValue({ items: Array.from({ length: 100 }, (_, i) => summary({ staffId: `s-${i}` })),
      page: 1, limit: 100, total: 999_999, hasMore: true });
    await expect(getOperationalMapOverlay(request, actor)).rejects.toBeInstanceOf(OperationalRosterTooLargeError);
  });
});
