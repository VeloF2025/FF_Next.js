import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), evaluate: vi.fn() }));
vi.mock('../evidenceQueries', () => ({ loadOperationalEvidence: mocks.load }));
vi.mock('../evaluateStatus', () => ({ evaluateOperationalStatus: mocks.evaluate }));
import { getOperationalEvidenceDetail, getOperationalRosterStatus, OperationalStatusRequestError } from '../statusService';

const point = { latitude: -26.1, longitude: 28.1, recordedAt: '2026-08-14T08:00:00Z' };
const evidence = { asOf: '2026-08-14T12:00:00Z', workDate: '2026-08-14', staffId: 'staff-1', staffName: 'Driver', assignment: { assignmentId: 'a', source: 'roster', projectId: 'p', projectName: 'Project One', operationalSiteId: 's', operationalSiteName: 'Site One', ambiguous: false, siteGeometryValid: true, siteGeometryLowConfidence: false }, schedule: { policyId: 'policy', workDate: '2026-08-14', timezone: 'Africa/Johannesburg', scheduled: true, explicitWork: false, startTime: '08:00', endTime: '17:00', graceMinutes: 15 }, attendance: { entryId: 'e', clockInAt: point.recordedAt, clockOutAt: null, clockInPoint: point, clockOutPoint: null, matchedSiteId: 's', requiredSite: { valid: true, inside: true, distanceM: 0, knownSiteId: 's' } }, vehicle: { assignmentId: null, vehicleId: null, provider: null, accountRef: null, staleAfterSeconds: null, positions: [] }, rule: { id: 'r', version: 1, timezone: 'Africa/Johannesburg', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null, monitoringBeforeMinutes: 60, monitoringAfterMinutes: 60, arrivalDwellMinutes: 5, wrongSiteConfirmationMinutes: 5, earlyDepartureConfirmationMinutes: 10, approachingDistanceMeters: 10000, approachingMinReadings: 2, minimumMovingSpeedKmh: 5, evidenceMismatchToleranceMeters: 250 }, sourceWarnings: [], sourceErrors: [] };
const evaluation = { status: 'attendance_confirmed', flags: [], reasonCodes: ['inside'], ruleId: 'r', ruleVersion: 1, sourceTimestamps: [point.recordedAt], thresholdsUsed: {} };

beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue({ items: [evidence], total: 1 }); mocks.evaluate.mockReturnValue(evaluation); });

describe('status service validation and privacy', () => {
  it.each([
    { projectId: 'p', workDate: 'bad', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 },
    { projectId: 'p', workDate: '2026-02-30', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 },
    { projectId: 'p', workDate: '2026-08-14', asOf: 'bad', page: 1, limit: 25 },
    { projectId: 'p', workDate: '2026-08-14', asOf: '2026-02-30T12:00:00Z', page: 1, limit: 25 },
    { projectId: 'p', workDate: '2026-01-01', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 },
    { projectId: 'p', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', page: 0, limit: 25 },
    { projectId: 'p', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 101 },
  ])('rejects invalid or out-of-bounds request %#', async (request) => {
    await expect(getOperationalRosterStatus(request)).rejects.toBeInstanceOf(OperationalStatusRequestError);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('returns coordinate-free summaries and isolates one malformed evaluation', async () => {
    mocks.load.mockResolvedValue({ items: [evidence, { ...evidence, staffId: 'staff-2' }], total: 2 });
    mocks.evaluate.mockReturnValueOnce(evaluation).mockImplementationOnce(() => { throw new Error('bad person'); });
    const result = await getOperationalRosterStatus({ projectId: 'p', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 });
    expect(result.items).toHaveLength(2); expect(JSON.stringify(result)).not.toContain('latitude');
    expect(result.items[1]).toMatchObject({ status: 'unverifiable', flags: ['evidence_source_error'] });
  });

  /**
   * Guards `windowFor`. A day with no shift window (Sunday, or an untracked
   * driver) has no monitoring instants to report. `summary()` is NOT wrapped by
   * safelyEvaluate, so dropping that guard makes operationalWindow throw and
   * takes down the whole roster response, not just one row.
   */
  it('reports null window instants for a schedule that has no shift window', async () => {
    mocks.load.mockResolvedValue({
      items: [{ ...evidence, schedule: { ...evidence.schedule, scheduled: false, startTime: null, endTime: null } }],
      total: 1,
    });
    const result = await getOperationalRosterStatus({ projectId: 'p', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 });
    expect(result.items[0]).toMatchObject({
      monitoringStart: null, scheduledStart: null, graceEnd: null,
      scheduledEnd: null, monitoringEnd: null,
    });
  });

  it('preserves labels, exact window instants, pagination, and GPS freshness metadata', async () => {
    mocks.load.mockResolvedValue({
      items: [{ ...evidence, vehicle: { ...evidence.vehicle, staleAfterSeconds: 7200 } }],
      total: 51,
    });
    const result = await getOperationalRosterStatus({ projectId: 'p', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 });
    expect(result).toMatchObject({ total: 51, hasMore: true, page: 1, limit: 25 });
    expect(result.items[0]).toMatchObject({
      projectName: 'Project One', operationalSiteName: 'Site One', gpsStaleAfterSeconds: 7200,
      monitoringStart: '2026-08-14T05:00:00.000Z', scheduledStart: '2026-08-14T06:00:00.000Z',
      graceEnd: '2026-08-14T06:15:00.000Z', scheduledEnd: '2026-08-14T15:00:00.000Z',
      monitoringEnd: '2026-08-14T16:00:00.000Z',
    });
  });

  it('preserves total and reports no next page for an empty out-of-range page', async () => {
    mocks.load.mockResolvedValue({ items: [], total: 42 });
    await expect(getOperationalRosterStatus({ projectId: 'p', workDate: '2026-08-14',
      asOf: '2026-08-14T12:00:00Z', page: 3, limit: 25 }))
      .resolves.toMatchObject({ items: [], page: 3, limit: 25, total: 42, hasMore: false });
  });

  it('returns only minimum decision points in protected detail', async () => {
    const detail = await getOperationalEvidenceDetail({ projectId: 'p', staffId: 'staff-1', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z' });
    expect(detail.points).toEqual([{ source: 'attendance_clock_in', ...point }]);
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p', staffId: 'staff-1' }));
    expect(JSON.stringify(detail)).not.toContain('clockInPoint');
    expect(JSON.stringify(detail)).not.toContain('positions');
    expect(detail).not.toHaveProperty('evidence');
    expect(detail).toMatchObject({
      projectName: 'Project One', operationalSiteName: 'Site One', gpsStaleAfterSeconds: null,
      monitoringStart: '2026-08-14T05:00:00.000Z', monitoringEnd: '2026-08-14T16:00:00.000Z',
    });
  });

  it('returns coordinates only for decision-relevant sources inside the privacy window', async () => {
    const vehiclePoint = { ...point, recordedAt: '2026-08-14T08:05:00Z' };
    mocks.load.mockResolvedValue({ items: [{ ...evidence, vehicle: { assignmentId: 'va', vehicleId: 'v', provider: 'netstar', accountRef: 'a', staleAfterSeconds: 7200, positions: [{ ...vehiclePoint, valid: true, inside: false, distanceM: 500, speedKmh: 0, knownSiteId: null }] } }], total: 1 });
    mocks.evaluate.mockReturnValue(evaluation);
    const attendanceDecision = await getOperationalEvidenceDetail({ projectId: 'p', staffId: 'staff-1', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z' });
    expect(attendanceDecision.points).toEqual([{ source: 'attendance_clock_in', ...point }]);

    mocks.load.mockResolvedValue({ items: [{ ...evidence, asOf: '2026-08-14T16:00:01Z' }], total: 1 });
    mocks.evaluate.mockReturnValue({ ...evaluation, status: 'off_duty', reasonCodes: ['outside_monitoring_window'] });
    const outside = await getOperationalEvidenceDetail({ projectId: 'p', staffId: 'staff-1', workDate: '2026-08-14', asOf: '2026-08-14T16:00:01Z' });
    expect(outside.points).toEqual([]);
  });

  it('allows oversight detail without a project scope', async () => {
    await expect(getOperationalEvidenceDetail({ staffId: 'staff-1', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z' })).resolves.toMatchObject({ staffId: 'staff-1' });
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined, staffId: 'staff-1' }));
  });

  it.each(['', '00000000-0000-0000-0000-000000000000'])('rejects invalid detail projectId %#', async (projectId) => {
    await expect(getOperationalEvidenceDetail({ projectId, staffId: 'staff-1', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z' } as Parameters<typeof getOperationalEvidenceDetail>[0])).rejects.toBeInstanceOf(OperationalStatusRequestError);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('propagates a top-level load failure', async () => {
    mocks.load.mockRejectedValue(new Error('database unavailable'));
    await expect(getOperationalRosterStatus({ projectId: 'p', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', page: 1, limit: 25 })).rejects.toThrow('database unavailable');
  });
});

/**
 * The history window is measured from the SAST start of the work date.
 *
 * `monitorService` derives `workDate` from `effectiveAt` in SAST. A SAST day
 * begins at 22:00Z the day before, so between SAST midnight and 02:00 the
 * derived work date is already tomorrow in UTC terms — and a window measured
 * from UTC midnight puts `asOf` BEFORE the start of its own work date. That is
 * a negative age, and it was rejecting every monitor run in those two hours:
 * 96 failures on the shared database, 48 at UTC hour 22 and 48 at hour 23, and
 * none at any other hour.
 */
describe('history window in SAST', () => {
  const request = (workDate: string, asOf: string) => ({ projectId: 'p', workDate, asOf, page: 1, limit: 25 });

  it.each([
    ['22:00:00Z', '2026-08-15'],
    ['22:30:00Z', '2026-08-15'],
    ['23:59:59Z', '2026-08-15'],
  ])('accepts the SAST work date that has already begun at %s', async (time, workDate) => {
    await expect(getOperationalRosterStatus(request(workDate, `2026-08-14T${time}`))).resolves.toBeDefined();
    expect(mocks.load).toHaveBeenCalled();
  });

  it('still refuses a work date that has not begun in SAST either', async () => {
    // 21:59Z on the 14th is 23:59 SAST, still the 14th. The 15th is genuinely
    // in the future, and the guard must keep saying so.
    await expect(getOperationalRosterStatus(request('2026-08-15', '2026-08-14T21:59:00Z')))
      .rejects.toBeInstanceOf(OperationalStatusRequestError);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('still refuses a work date past the far edge of the window', async () => {
    await expect(getOperationalRosterStatus(request('2026-07-01', '2026-08-14T12:00:00Z')))
      .rejects.toBeInstanceOf(OperationalStatusRequestError);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('applies the same window to the evidence detail request', async () => {
    await expect(getOperationalEvidenceDetail({
      projectId: 'p', staffId: 'staff-1', workDate: '2026-08-15', asOf: '2026-08-14T22:30:00Z',
    })).resolves.toBeDefined();
  });
});
