import { describe, expect, it } from 'vitest';

import { assignmentFingerprint, assignmentSourceVersion } from '../fingerprint';
import type { AssignmentProposalRow } from '../types';

const row = (staffId: string, projectId: string, operationalSiteId: string): AssignmentProposalRow => ({
  staffId,
  projectId,
  operationalSiteId,
  startDate: '2026-08-10',
  endDate: '2026-08-12',
  assignmentKind: 'roster',
  vehicleAssignmentId: null,
  reason: null,
});

const ROW_A = row('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
const ROW_B = row('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666');

describe('assignmentFingerprint', () => {
  it('is stable regardless of proposal row order', () => {
    expect(assignmentFingerprint([ROW_A, ROW_B], 'v1')).toBe(assignmentFingerprint([ROW_B, ROW_A], 'v1'));
  });

  it('is stable when rows tie on the primary sort fields', () => {
    const selectedVehicle = { ...ROW_A, vehicleAssignmentId: '77777777-7777-4777-8777-777777777777', reason: 'Cover shift' };
    const noVehicle = { ...ROW_A, vehicleAssignmentId: null, reason: null };

    expect(assignmentFingerprint([selectedVehicle, noVehicle], 'v1')).toBe(
      assignmentFingerprint([noVehicle, selectedVehicle], 'v1'),
    );
  });

  it('changes when any material source version changes', () => {
    const base = {
      assignments: '2026-08-10T08:00:00.000Z',
      vehicles: '2026-08-10T08:00:00.000Z',
      vehicleAssignments: '2026-08-10T08:00:00.000Z',
      staff: '2026-08-10T08:00:00.000Z',
      projectSites: '2026-08-10T08:00:00.000Z',
      teamMembers: '2026-08-10T08:00:00.000Z',
      attendancePolicies: '2026-08-10T08:00:00.000Z',
    };
    const baseline = assignmentFingerprint([ROW_A], assignmentSourceVersion(base));

    for (const key of Object.keys(base) as Array<keyof typeof base>) {
      const changed = { ...base, [key]: '2026-08-11T08:00:00.000Z' };
      expect(assignmentFingerprint([ROW_A], assignmentSourceVersion(changed))).not.toBe(baseline);
    }
  });

  it('does not change when callers change display-only labels outside the canonical rows', () => {
    const sourceVersion = assignmentSourceVersion({
      assignments: '1', vehicles: '1', vehicleAssignments: '1', staff: '1', projectSites: '1', teamMembers: '1', attendancePolicies: '1',
    });

    expect(assignmentFingerprint([ROW_A], sourceVersion)).toBe(assignmentFingerprint([{ ...ROW_A }], sourceVersion));
  });
});
