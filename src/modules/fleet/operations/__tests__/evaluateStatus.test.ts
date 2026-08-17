import { describe, expect, it } from 'vitest';
import { evaluateOperationalStatus } from '../evaluateStatus';
import type { OperationalEvidence, OperationalStatus } from '../types';

const insidePoint = { latitude: -26.1, longitude: 28.1, recordedAt: '2026-08-14T06:05:00Z' };
const rule = {
  id: 'rule-1', version: 3, timezone: 'Africa/Johannesburg', effectiveFrom: '2026-08-01T00:00:00Z', effectiveTo: null,
  monitoringBeforeMinutes: 60, monitoringAfterMinutes: 60, arrivalDwellMinutes: 5,
  wrongSiteConfirmationMinutes: 5, earlyDepartureConfirmationMinutes: 10,
  approachingDistanceMeters: 10_000, approachingMinReadings: 2, minimumMovingSpeedKmh: 5,
  evidenceMismatchToleranceMeters: 250,
};
function evidence(change: Partial<OperationalEvidence> = {}): OperationalEvidence {
  return {
    asOf: '2026-08-14T06:20:00Z', workDate: '2026-08-14', staffId: 'staff-1', staffName: 'Driver One', rule,
    assignment: { assignmentId: 'assignment-1', source: 'roster', projectId: 'project-1', projectName: 'Project One', operationalSiteId: 'site-1', operationalSiteName: 'Site One', ambiguous: false, siteGeometryValid: true, siteGeometryLowConfidence: false },
    schedule: { policyId: 'policy-1', workDate: '2026-08-14', timezone: 'Africa/Johannesburg', scheduled: true, explicitWork: false, startTime: '08:00:00', endTime: '17:00:00', graceMinutes: 15 },
    attendance: { entryId: null, clockInAt: null, clockOutAt: null, clockInPoint: null, clockOutPoint: null, matchedSiteId: null, requiredSite: null },
    vehicle: { assignmentId: null, vehicleId: null, provider: null, accountRef: null, staleAfterSeconds: null, positions: [] },
    sourceWarnings: [], sourceErrors: [], ...change,
  };
}
const attendanceInside = {
  entryId: 'entry-1', clockInAt: '2026-08-14T06:00:00Z', clockOutAt: null, clockInPoint: insidePoint,
  clockOutPoint: null, matchedSiteId: 'site-1', requiredSite: { valid: true, inside: true, distanceM: 0, knownSiteId: 'site-1' },
};
const vehicleInside = {
  assignmentId: 'va-1', vehicleId: 'vehicle-1', provider: 'provider', accountRef: 'account', staleAfterSeconds: 3600,
  positions: [
    { ...insidePoint, recordedAt: '2026-08-14T06:00:00Z', valid: true, inside: true, distanceM: 0, speedKmh: 0, knownSiteId: 'site-1' },
    { ...insidePoint, valid: true, inside: true, distanceM: 0, speedKmh: 0, knownSiteId: 'site-1' },
  ],
};

function status(input: OperationalEvidence): OperationalStatus { return evaluateOperationalStatus(input).status; }

describe('evaluateOperationalStatus', () => {
  it('covers the gate statuses and explicit unscheduled work', () => {
    expect(status(evidence({ asOf: '2026-08-14T16:00:01Z' }))).toBe('off_duty');
    expect(status(evidence({ asOf: '2026-08-14T06:10:00Z' }))).toBe('scheduled_not_due');
    expect(status(evidence({ assignment: { ...evidence().assignment, operationalSiteId: null } }))).toBe('unassigned');
    expect(status(evidence({ schedule: null }))).toBe('unverifiable');
    expect(status(evidence({ schedule: { ...evidence().schedule!, scheduled: false, explicitWork: true } }))).toBe('late');
  });

  it('distinguishes attendance-only, vehicle-only, and dual confirmation', () => {
    expect(status(evidence({ attendance: attendanceInside }))).toBe('attendance_confirmed');
    const vehicleOnly = evaluateOperationalStatus(evidence({ vehicle: vehicleInside }));
    expect(vehicleOnly).toMatchObject({ status: 'vehicle_on_site_driver_unconfirmed', flags: expect.arrayContaining(['attendance_missing', 'vehicle_driver_presence_unconfirmed']) });
    expect(status(evidence({ attendance: attendanceInside, vehicle: vehicleInside }))).toBe('on_site_dual');
  });

  it('returns approaching only for a fresh decreasing moving vehicle trend', () => {
    const positions = [
      { ...insidePoint, recordedAt: '2026-08-14T06:10:00Z', valid: true, inside: false, distanceM: 9000, speedKmh: 20, knownSiteId: null },
      { ...insidePoint, recordedAt: '2026-08-14T06:15:00Z', valid: true, inside: false, distanceM: 7000, speedKmh: 18, knownSiteId: null },
    ];
    expect(status(evidence({ vehicle: { ...vehicleInside, positions } }))).toBe('approaching');
  });

  it('reports healthy missing arrival as late and a source data gap as unverifiable', () => {
    expect(status(evidence())).toBe('late');
    const gap = evaluateOperationalStatus(evidence({ vehicle: { ...vehicleInside, positions: [] } }));
    expect(gap).toMatchObject({ status: 'unverifiable', flags: expect.arrayContaining(['gps_missing', 'attendance_missing']) });
  });

  it('reports agreed known wrong-site evidence and confirms a deliberate wrong-site clock-in after the delay', () => {
    const wrongPoint = { latitude: -26.2, longitude: 28.2, recordedAt: '2026-08-14T06:00:00Z' };
    const attendance = { ...attendanceInside, clockInPoint: wrongPoint, matchedSiteId: 'site-2', requiredSite: { valid: true, inside: false, distanceM: 2000, knownSiteId: 'site-2' } };
    const positions = ['06:00:00', '06:05:00'].map((time) => ({ ...wrongPoint, recordedAt: `2026-08-14T${time}Z`, valid: true, inside: false, distanceM: 2000, speedKmh: 0, knownSiteId: 'site-2' }));
    expect(status(evidence({ attendance, vehicle: { ...vehicleInside, positions } }))).toBe('wrong_site');
    expect(status(evidence({ attendance, vehicle: evidence().vehicle }))).toBe('wrong_site');
    expect(status(evidence({ attendance: { ...attendance, clockOutAt: '2026-08-14T12:00:00Z' } }))).toBe('left_early');
    expect(status(evidence({ attendance: { ...attendance, clockOutAt: '2026-08-14T15:00:00Z' } }))).toBe('shift_complete');
  });

  it('confirms a normalized AOI wrong site without an Attendance circle id', () => {
    const attendance = { ...attendanceInside, matchedSiteId: null,
      requiredSite: { valid: true, inside: false, distanceM: 2000, knownSiteId: 'aoi-site-2' } };
    expect(status(evidence({ attendance }))).toBe('wrong_site');
  });

  it('distinguishes cross-site mismatch from coordinate jitter within tolerance', () => {
    const attendance = { ...attendanceInside, matchedSiteId: 'site-2', requiredSite: { valid: true, inside: false, distanceM: 1000, knownSiteId: 'site-2' } };
    const farVehicle = { ...vehicleInside, positions: vehicleInside.positions.map((point) => ({ ...point, latitude: -27, longitude: 29, knownSiteId: 'site-3' })) };
    expect(status(evidence({ attendance, vehicle: farVehicle }))).toBe('evidence_mismatch');
    const jitterVehicle = { ...vehicleInside, positions: vehicleInside.positions.map((point) => ({ ...point, latitude: -26.1001, longitude: 28.1001, knownSiteId: 'site-3' })) };
    expect(status(evidence({ attendance: attendanceInside, vehicle: jitterVehicle }))).toBe('on_site_dual');
  });

  // Both sources confirmed a wrong site but named DIFFERENT known ids while
  // sitting within the mismatch tolerance of each other (overlapping geometry).
  // That fell through every site-conflict branch — ids differ, a vehicle exists,
  // a clock-in exists — and both confirmations were silently discarded, letting
  // the evaluation continue to arrival/departure as if nothing were wrong.
  it('confirms wrong_site when both sources confirm different co-located wrong sites', () => {
    const wrongPoint = { latitude: -26.2, longitude: 28.2, recordedAt: '2026-08-14T06:00:00Z' };
    const attendance = {
      ...attendanceInside,
      clockInPoint: wrongPoint,
      matchedSiteId: 'site-2',
      requiredSite: { valid: true, inside: false, distanceM: 2000, knownSiteId: 'site-2' },
    };
    // Same coordinates as the clock-in, so within mismatch tolerance, but a
    // different known-site id.
    const positions = ['06:00:00', '06:05:00'].map((time) => ({
      ...wrongPoint, recordedAt: `2026-08-14T${time}Z`,
      valid: true, inside: false, distanceM: 2000, speedKmh: 0, knownSiteId: 'site-3',
    }));

    const result = evaluateOperationalStatus(evidence({ attendance, vehicle: { ...vehicleInside, positions } }));

    expect(result.status).toBe('wrong_site');
    // Positive pin on WHY: it is the agreed-wrong-site path, not an incidental
    // wrong_site from one source, and not a fallthrough to arrival/departure.
    expect(result.reasonCodes).toContain('sources_agree_wrong_site');
  });

  it('handles early and normal Attendance clock-out plus confirmed vehicle departure', () => {
    expect(status(evidence({ attendance: { ...attendanceInside, clockOutAt: '2026-08-14T12:00:00Z' } }))).toBe('left_early');
    expect(status(evidence({ attendance: { ...attendanceInside, clockOutAt: '2026-08-14T15:00:00Z' } }))).toBe('shift_complete');
    const positions = [
      ...['11:50:00', '11:55:00'].map((time) => ({ ...insidePoint, recordedAt: `2026-08-14T${time}Z`, valid: true, inside: true, distanceM: 0, speedKmh: 0, knownSiteId: 'site-1' })),
      ...['12:00:00', '12:05:00', '12:10:00'].map((time) => ({ ...insidePoint, recordedAt: `2026-08-14T${time}Z`, valid: true, inside: false, distanceM: 500, speedKmh: 20, knownSiteId: null })),
    ];
    expect(status(evidence({ asOf: '2026-08-14T12:10:00Z', vehicle: { ...vehicleInside, staleAfterSeconds: 3600, positions } }))).toBe('left_early');
  });

  it('keeps a confirmed early departure classified by departure time after shift end', () => {
    const positions = [
      ...['11:50:00', '11:55:00'].map((time) => ({ ...insidePoint, recordedAt: `2026-08-14T${time}Z`, valid: true, inside: true, distanceM: 0, speedKmh: 0, knownSiteId: 'site-1' })),
      ...['12:00:00', '12:05:00', '12:10:00'].map((time) => ({ ...insidePoint, recordedAt: `2026-08-14T${time}Z`, valid: true, inside: false, distanceM: 500, speedKmh: 20, knownSiteId: null })),
    ];
    const result = evaluateOperationalStatus(evidence({
      asOf: '2026-08-14T15:10:00Z',
      vehicle: { ...vehicleInside, staleAfterSeconds: 300, positions },
    }));
    expect(result).toMatchObject({ status: 'left_early', reasonCodes: ['vehicle_departure_confirmed_early'] });
  });

  it('does not confirm wrong-site continuity across two different known sites', () => {
    const positions = [
      { ...insidePoint, recordedAt: '2026-08-14T06:00:00Z', valid: true, inside: false, distanceM: 500, speedKmh: 0, knownSiteId: 'site-2' },
      { ...insidePoint, recordedAt: '2026-08-14T06:05:00Z', valid: true, inside: false, distanceM: 500, speedKmh: 0, knownSiteId: 'site-3' },
    ];
    const result = evaluateOperationalStatus(evidence({
      asOf: '2026-08-14T06:05:00Z',
      vehicle: { ...vehicleInside, staleAfterSeconds: 300, positions },
    }));
    expect(result.status).not.toBe('wrong_site');
    expect(result.flags).toContain('wrong_site_confirmation_pending');
  });

  it.each([
    { recordedAt: '2026-08-14T04:00:00Z', valid: true },
    { recordedAt: '2026-08-14T06:00:00Z', valid: false },
    { recordedAt: '2026-08-14T13:00:00Z', valid: true },
  ])('does not treat an unusable historical inside fix as prior confirmed presence: %o', (historical) => {
    const positions = [
      { ...vehicleInside.positions[0]!, ...historical },
      ...['12:00:00', '12:10:00'].map((time) => ({ ...insidePoint, recordedAt: `2026-08-14T${time}Z`, valid: true, inside: false, distanceM: 500, speedKmh: 20, knownSiteId: null })),
    ];
    expect(status(evidence({ asOf: '2026-08-14T12:10:00Z', vehicle: { ...vehicleInside, staleAfterSeconds: 3600, positions } }))).toBe('late');
  });

  it('requires a confirmed fresh inside sequence before a confirmed departure', () => {
    const positions = [
      { ...vehicleInside.positions[0]!, recordedAt: '2026-08-14T11:59:00Z' },
      ...['12:00:00', '12:10:00'].map((time) => ({ ...insidePoint, recordedAt: `2026-08-14T${time}Z`, valid: true, inside: false, distanceM: 500, speedKmh: 20, knownSiteId: null })),
    ];
    expect(status(evidence({ asOf: '2026-08-14T12:10:00Z', vehicle: { ...vehicleInside, staleAfterSeconds: 3600, positions } }))).toBe('late');
  });

  it('does not reconstruct prior-arrival continuity across an intervening outside fix', () => {
    const positions = [
      { ...insidePoint, recordedAt: '2026-08-14T11:45:00Z', valid: true, inside: true, distanceM: 0, speedKmh: 0, knownSiteId: 'site-1' },
      { ...insidePoint, recordedAt: '2026-08-14T11:50:00Z', valid: true, inside: false, distanceM: 500, speedKmh: 5, knownSiteId: null },
      { ...insidePoint, recordedAt: '2026-08-14T11:55:00Z', valid: true, inside: true, distanceM: 0, speedKmh: 0, knownSiteId: 'site-1' },
      ...['12:00:00', '12:10:00'].map((time) => ({ ...insidePoint, recordedAt: `2026-08-14T${time}Z`,
        valid: true, inside: false, distanceM: 500, speedKmh: 20, knownSiteId: null })),
    ];
    expect(status(evidence({ asOf: '2026-08-14T12:10:00Z',
      vehicle: { ...vehicleInside, staleAfterSeconds: 3600, positions } }))).toBe('late');
  });

  it('returns pending and evidence-quality supporting flags', () => {
    const pendingVehicle = { ...vehicleInside, positions: [vehicleInside.positions[0]!] };
    const result = evaluateOperationalStatus(evidence({ assignment: { ...evidence().assignment, siteGeometryLowConfidence: true }, vehicle: pendingVehicle, sourceWarnings: ['review'] }));
    expect(result.flags).toEqual(expect.arrayContaining(['attendance_missing', 'arrival_dwell_pending', 'site_geometry_low_confidence']));
  });

  it('exposes every supporting evidence and boundary flag from its real condition', () => {
    const cases: Array<[string, OperationalEvidence]> = [
      ['gps_stale', evidence({ vehicle: { ...vehicleInside, positions: vehicleInside.positions.map((point) => ({ ...point, recordedAt: '2026-08-14T04:00:00Z' })) } })],
      ['gps_missing', evidence({ vehicle: { ...vehicleInside, positions: [] } })],
      ['attendance_missing', evidence()], ['no_assigned_vehicle', evidence()],
      ['assignment_ambiguous', evidence({ assignment: { ...evidence().assignment, ambiguous: true } })],
      ['site_geometry_low_confidence', evidence({ assignment: { ...evidence().assignment, siteGeometryLowConfidence: true } })],
      ['outside_monitoring_window', evidence({ asOf: '2026-08-14T16:00:01Z' })],
      ['arrival_dwell_pending', evidence({ vehicle: { ...vehicleInside, positions: [vehicleInside.positions[0]!] } })],
      ['wrong_site_confirmation_pending', evidence({ attendance: { ...attendanceInside, clockInAt: '2026-08-14T06:18:00Z', matchedSiteId: 'site-2', requiredSite: { valid: true, inside: false, distanceM: 500, knownSiteId: 'site-2' } } })],
      ['departure_confirmation_pending', evidence({ asOf: '2026-08-14T12:01:00Z', vehicle: { ...vehicleInside, staleAfterSeconds: 30_000, positions: [...vehicleInside.positions, { ...vehicleInside.positions[0]!, recordedAt: '2026-08-14T12:00:00Z', inside: false, distanceM: 500 }] } })],
      ['vehicle_driver_presence_unconfirmed', evidence({ vehicle: vehicleInside })],
      ['evidence_source_error', evidence({ sourceErrors: ['attendance load failed'] })],
    ];
    for (const [flag, input] of cases) expect(evaluateOperationalStatus(input).flags, flag).toContain(flag);
  });

  it('returns explainability metadata without disciplinary or payroll mutations', () => {
    const result = evaluateOperationalStatus(evidence({ attendance: attendanceInside }));
    expect(result).toMatchObject({ ruleId: 'rule-1', ruleVersion: 3, sourceTimestamps: ['2026-08-14T06:00:00Z'], thresholdsUsed: expect.objectContaining({ graceMinutes: 15 }) });
    expect(result).not.toHaveProperty('payrollAdjustment'); expect(result).not.toHaveProperty('disciplinaryAction');
    expect(result).not.toHaveProperty('fraudFlag'); expect(result).not.toHaveProperty('scoreMutation');
  });

  it('includes the provider freshness threshold in explainability metadata', () => {
    expect(evaluateOperationalStatus(evidence({ vehicle: vehicleInside })).thresholdsUsed)
      .toMatchObject({ gpsStaleAfterSeconds: 3600 });
  });
});
