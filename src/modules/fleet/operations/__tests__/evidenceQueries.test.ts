import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), loadRule: vi.fn(), stale: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));
vi.mock('../ruleQueries', () => ({ loadEffectiveRule: mocks.loadRule }));
vi.mock('@/services/tracking/staleness', () => ({ staleAfterSecondsFor: mocks.stale }));

import { loadOperationalEvidence } from '../evidenceQueries';

const rule = { id: 'rule-1', version: 1, timezone: 'Africa/Johannesburg', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null, monitoringBeforeMinutes: 60, monitoringAfterMinutes: 60, arrivalDwellMinutes: 5, wrongSiteConfirmationMinutes: 5, earlyDepartureConfirmationMinutes: 10, approachingDistanceMeters: 10000, approachingMinReadings: 2, minimumMovingSpeedKmh: 5, evidenceMismatchToleranceMeters: 250, changeReason: null, createdBy: null, createdAt: '2026-01-01T00:00:00Z' };
const roster = (count: number) => Array.from({ length: count }, (_, index) => ({ staff_id: `staff-${index}`, staff_name: `Driver ${index}`, assignment_id: `assignment-${index}`, assignment_kind: 'roster', project_id: 'project-1', operational_site_id: 'site-1', scheduled: true, assignment_ambiguous: false }));
const schedules = (count: number, values: Record<string, unknown> = {}) => Array.from({ length: count }, (_, index) => ({ staff_id: `staff-${index}`, policy_id: 'policy-1', schedule_policy_id: 'schedule-policy-1', timezone: 'Africa/Johannesburg', start_time: '08:00:00', end_time: '17:00:00', grace_minutes: 15, scheduled: true, ...values }));

beforeEach(() => { vi.clearAllMocks(); mocks.loadRule.mockResolvedValue(rule); mocks.stale.mockReturnValue(300); });

it.each([1, 100])('loads %i staff with a constant seven set-based queries', async (count) => {
  mocks.query.mockResolvedValueOnce(roster(count)).mockResolvedValueOnce(schedules(count)).mockResolvedValueOnce([])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  await expect(loadOperationalEvidence({ projectId: 'project-1', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', limit: count, offset: 0 })).resolves.toHaveLength(count);
  expect(mocks.query).toHaveBeenCalledTimes(6); expect(mocks.loadRule).toHaveBeenCalledTimes(1);
  for (const [sql] of mocks.query.mock.calls) expect(sql).toEqual(expect.any(String));
});

describe('evidence mapping', () => {
  it('maps trackers once per provider/account and bounds GPS history through asOf', async () => {
    mocks.query.mockResolvedValueOnce(roster(2)).mockResolvedValueOnce(schedules(2)).mockResolvedValueOnce([]).mockResolvedValueOnce([
      { staff_id: 'staff-0', assignment_id: 'va-0', vehicle_id: 'vehicle-0', provider: 'netstar', account_ref: 'account' },
      { staff_id: 'staff-1', assignment_id: 'va-1', vehicle_id: 'vehicle-1', provider: 'netstar', account_ref: 'account' },
    ]).mockResolvedValueOnce([{ vehicle_id: 'vehicle-0', recorded_at: new Date('2026-08-14T11:55:00Z'), latitude: '-26.1', longitude: '28.1', speed_kmh: '12', site_inside: false, site_distance_m: 300, known_site_id: 'site-2' }]).mockResolvedValueOnce([]);
    const result = await loadOperationalEvidence({ projectId: 'project-1', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', limit: 25, offset: 0 });
    expect(mocks.stale).toHaveBeenCalledTimes(1); expect(mocks.stale).toHaveBeenCalledWith('netstar', 'account');
    const gpsCall = mocks.query.mock.calls[4]!; expect(gpsCall[0]).toContain('recorded_at BETWEEN'); expect(gpsCall[1]).toContain('2026-08-14T12:00:00.000Z');
    expect(gpsCall[1]).toContain('2026-08-14T04:50:00.000Z');
    expect(result[0]!.vehicle.positions[0]).toMatchObject({ latitude: -26.1, longitude: 28.1, speedKmh: 12, knownSiteId: 'site-2' });
  });

  it('maps persisted policy grace and a distinct known attendance site', async () => {
    mocks.query.mockResolvedValueOnce(roster(1)).mockResolvedValueOnce(schedules(1, { schedule_policy_id: 'custom-policy', grace_minutes: 27 })).mockResolvedValueOnce([
      { staff_id: 'staff-0', entry_id: 'entry', clock_in_at: new Date('2026-08-14T06:05:00Z'), latitude: -26.1, longitude: 28.1, site_valid: true, site_inside: false, site_distance_m: 500, known_site_id: 'site-2' },
    ]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ operational_site_id: 'site-1', geometry_valid: true }]);
    const [result] = await loadOperationalEvidence({ projectId: 'project-1', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', limit: 25, offset: 0 });
    expect(result!.schedule).toMatchObject({ policyId: 'custom-policy', graceMinutes: 27 });
    expect(result!.attendance.requiredSite).toMatchObject({ inside: false, distanceM: 500, knownSiteId: 'site-2' });
    expect(String(mocks.query.mock.calls[2]![0])).toContain('candidate.project_id=$4::uuid');
  });

  it('isolates malformed staff mapping as evidence_source_error', async () => {
    mocks.query.mockResolvedValueOnce(roster(1)).mockResolvedValueOnce(schedules(1, { grace_minutes: 'bad' }))
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const [result] = await loadOperationalEvidence({ projectId: 'project-1', workDate: '2026-08-14', asOf: '2026-08-14T12:00:00Z', limit: 25, offset: 0 });
    expect(result!.sourceErrors).toContain('malformed_evidence');
  });
});
