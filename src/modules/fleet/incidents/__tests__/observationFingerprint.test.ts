import { describe, expect, it } from 'vitest';
import { buildAssignmentIdentity, computeObservationFingerprint, type ObservationFingerprintInput } from '../observationFingerprint';

function baseInput(overrides: Partial<ObservationFingerprintInput> = {}): ObservationFingerprintInput {
  return {
    incidentType: 'late', ruleId: 'rule-1', ruleVersion: 2, assignmentIdentity: 'assignment-1',
    reasonCodes: ['attendance_late', 'grace_expired'], freshnessBucket: 'fresh_5m',
    siteId: 'site-1', projectId: 'project-1', vehicleId: 'vehicle-1', conditionActive: true,
    ...overrides,
  };
}

describe('computeObservationFingerprint', () => {
  it('is deterministic for identical bounded input', () => {
    expect(computeObservationFingerprint(baseInput())).toBe(computeObservationFingerprint(baseInput()));
  });

  it('is a bounded, fixed-length hex digest regardless of reason-code count', () => {
    const short = computeObservationFingerprint(baseInput({ reasonCodes: ['a'] }));
    const long = computeObservationFingerprint(baseInput({ reasonCodes: Array.from({ length: 50 }, (_, i) => `reason_${i}`) }));
    expect(short).toMatch(/^[0-9a-f]{64}$/);
    expect(long).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is independent of reason-code order', () => {
    const a = computeObservationFingerprint(baseInput({ reasonCodes: ['b_code', 'a_code'] }));
    const b = computeObservationFingerprint(baseInput({ reasonCodes: ['a_code', 'b_code'] }));
    expect(a).toBe(b);
  });

  it('changes when the incident type changes', () => {
    const late = computeObservationFingerprint(baseInput({ incidentType: 'late' }));
    const wrongSite = computeObservationFingerprint(baseInput({ incidentType: 'wrong_site' }));
    expect(late).not.toBe(wrongSite);
  });

  it('changes when the rule version changes', () => {
    const v1 = computeObservationFingerprint(baseInput({ ruleVersion: 1 }));
    const v2 = computeObservationFingerprint(baseInput({ ruleVersion: 2 }));
    expect(v1).not.toBe(v2);
  });

  it('changes when reason codes materially differ', () => {
    const a = computeObservationFingerprint(baseInput({ reasonCodes: ['attendance_late'] }));
    const b = computeObservationFingerprint(baseInput({ reasonCodes: ['attendance_late', 'grace_expired'] }));
    expect(a).not.toBe(b);
  });

  it('changes when the freshness bucket changes without needing a raw timestamp', () => {
    const fresh = computeObservationFingerprint(baseInput({ freshnessBucket: 'fresh_5m' }));
    const stale = computeObservationFingerprint(baseInput({ freshnessBucket: 'stale_30m' }));
    expect(fresh).not.toBe(stale);
  });

  it('changes when condition-active state flips', () => {
    const active = computeObservationFingerprint(baseInput({ conditionActive: true }));
    const inactive = computeObservationFingerprint(baseInput({ conditionActive: false }));
    expect(active).not.toBe(inactive);
  });

  it('changes when site/project/vehicle identity differs', () => {
    const a = computeObservationFingerprint(baseInput({ siteId: 'site-1' }));
    const b = computeObservationFingerprint(baseInput({ siteId: 'site-2' }));
    expect(a).not.toBe(b);
  });

  it('treats null identity fields consistently rather than colliding with the string "null"', () => {
    const nullSite = computeObservationFingerprint(baseInput({ siteId: null }));
    const literalNullSite = computeObservationFingerprint(baseInput({ siteId: 'null' }));
    expect(nullSite).not.toBe(literalNullSite);
  });
});

describe('buildAssignmentIdentity', () => {
  it('prefers the operational assignment id when known', () => {
    expect(buildAssignmentIdentity('staff-1', 'vehicle-1', 'assignment-1')).toBe('assignment-1');
  });

  it('falls back to a staff/vehicle pair when there is no assignment id', () => {
    expect(buildAssignmentIdentity('staff-1', 'vehicle-1', null)).toBe('staff-1::vehicle-1');
  });

  it('falls back to just the staff id when the vehicle is unknown', () => {
    expect(buildAssignmentIdentity('staff-1', null, null)).toBe('staff-1::-');
  });

  it('returns null when neither staff nor vehicle nor assignment is known', () => {
    expect(buildAssignmentIdentity(null, null, null)).toBeNull();
  });
});
