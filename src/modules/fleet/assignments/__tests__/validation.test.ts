import { describe, expect, it } from 'vitest';

import {
  ProposalNormalizationError,
  normalizeProposal,
  validateProposal,
  type ProposalValidationContext,
} from '../validation';

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_STAFF_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const SITE_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_SITE_ID = '66666666-6666-4666-8666-666666666666';
const VEHICLE_ASSIGNMENT_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_VEHICLE_ASSIGNMENT_ID = '88888888-8888-4888-8888-888888888888';

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    staffId: STAFF_ID,
    projectId: PROJECT_ID,
    operationalSiteId: SITE_ID,
    startDate: '2026-08-10',
    endDate: '2026-08-12',
    assignmentKind: 'roster',
    vehicleAssignmentId: null,
    reason: null,
    ...overrides,
  };
}

function context(overrides: Partial<ProposalValidationContext> = {}): ProposalValidationContext {
  return {
    staffById: { [STAFF_ID]: { isActive: true } },
    projectsById: { [PROJECT_ID]: { isActive: true } },
    operationalSitesById: { [SITE_ID]: { projectId: PROJECT_ID, isActive: true } },
    existingAssignments: [],
    vehicleAssignments: [],
    vehicleProjectAssignments: [],
    unscheduledDatesByStaffId: {},
    ...overrides,
  };
}

describe('normalizeProposal', () => {
  it('rejects unknown proposal shapes and invalid identifiers or dates', () => {
    expect(() => normalizeProposal({ rows: [] })).toThrow(ProposalNormalizationError);
    expect(() => normalizeProposal([proposal({ staffId: 'not-a-uuid' })])).toThrow(/staffId/);
    expect(() => normalizeProposal([proposal({ startDate: '2026-02-30' })])).toThrow(/startDate/);
  });

  it('normalizes date-only ISO values and nullable text', () => {
    expect(normalizeProposal([proposal({
      staffId: STAFF_ID.toUpperCase(),
      startDate: ' 2026-08-10 ',
      endDate: '2026-08-12',
      vehicleAssignmentId: ' ',
      reason: '  Cover shift  ',
    })])).toEqual([expect.objectContaining({
      staffId: STAFF_ID,
      startDate: '2026-08-10',
      vehicleAssignmentId: null,
      reason: 'Cover shift',
    })]);
  });
});

describe('validateProposal', () => {
  it('blocks blank and ranged daily overrides', () => {
    const rows = normalizeProposal([
      proposal({ assignmentKind: 'daily_override', reason: ' ', startDate: '2026-08-10', endDate: '2026-08-11' }),
    ]);

    expect(validateProposal(rows, context()).map(({ code }) => code)).toEqual(
      expect.arrayContaining(['override_reason_required', 'daily_override_single_day']),
    );
  });

  it('blocks inactive staff, projects, and operational sites', () => {
    const rows = normalizeProposal([proposal()]);
    const conflicts = validateProposal(rows, context({
      staffById: { [STAFF_ID]: { isActive: false } },
      projectsById: { [PROJECT_ID]: { isActive: false } },
      operationalSitesById: { [SITE_ID]: { projectId: PROJECT_ID, isActive: false } },
    }));

    expect(conflicts.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['inactive_staff', 'inactive_project', 'inactive_operational_site']),
    );
  });

  it('blocks a site linked to another project', () => {
    const conflicts = validateProposal(normalizeProposal([proposal()]), context({
      operationalSitesById: { [SITE_ID]: { projectId: OTHER_PROJECT_ID, isActive: true } },
    }));

    expect(conflicts).toContainEqual(expect.objectContaining({ code: 'project_site_mismatch', level: 'blocking' }));
  });

  it('blocks overlaps with explicit assignments and other proposed rows', () => {
    const rows = normalizeProposal([
      proposal(),
      proposal({ startDate: '2026-08-12', endDate: '2026-08-15' }),
    ]);
    const conflicts = validateProposal(rows, context({
      existingAssignments: [{ staffId: STAFF_ID, startDate: '2026-08-11', endDate: '2026-08-13' }],
    }));

    expect(conflicts.filter(({ code }) => code === 'driver_overlap')).toHaveLength(4);
  });

  it('blocks vehicles assigned to another driver or only part of the range', () => {
    const rows = normalizeProposal([proposal({ vehicleAssignmentId: VEHICLE_ASSIGNMENT_ID })]);
    const wrongDriver = validateProposal(rows, context({
      vehicleAssignments: [{ id: VEHICLE_ASSIGNMENT_ID, staffId: OTHER_STAFF_ID, vehicleId: 'truck-1', startDate: '2026-08-01', endDate: '2026-08-31' }],
    }));
    const partialRange = validateProposal(rows, context({
      vehicleAssignments: [{ id: VEHICLE_ASSIGNMENT_ID, staffId: STAFF_ID, vehicleId: 'truck-1', startDate: '2026-08-11', endDate: '2026-08-31' }],
    }));

    expect(wrongDriver).toContainEqual(expect.objectContaining({ code: 'vehicle_not_assigned_to_staff' }));
    expect(partialRange).toContainEqual(expect.objectContaining({ code: 'vehicle_assignment_range' }));
  });

  it('blocks a selected vehicle already expected at another project/site', () => {
    const rows = normalizeProposal([proposal({ vehicleAssignmentId: VEHICLE_ASSIGNMENT_ID })]);
    const conflicts = validateProposal(rows, context({
      vehicleAssignments: [{ id: VEHICLE_ASSIGNMENT_ID, staffId: STAFF_ID, vehicleId: 'truck-1', startDate: '2026-08-01', endDate: '2026-08-31' }],
      vehicleProjectAssignments: [{ vehicleId: 'truck-1', projectId: OTHER_PROJECT_ID, operationalSiteId: OTHER_SITE_ID, startDate: '2026-08-11', endDate: '2026-08-13' }],
    }));

    expect(conflicts).toContainEqual(expect.objectContaining({ code: 'vehicle_project_conflict', level: 'blocking' }));
  });

  it('warns for unscheduled dates, omitted effective vehicles, and low-confidence AOIs', () => {
    const rows = normalizeProposal([proposal()]);
    const conflicts = validateProposal(rows, context({
      operationalSitesById: { [SITE_ID]: { projectId: PROJECT_ID, isActive: true, aoiConfidence: 'needs_verification' } },
      vehicleAssignments: [{ id: OTHER_VEHICLE_ASSIGNMENT_ID, staffId: STAFF_ID, vehicleId: 'truck-1', startDate: '2026-08-01', endDate: '2026-08-31' }],
      unscheduledDatesByStaffId: { [STAFF_ID]: ['2026-08-11'] },
    }));

    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unscheduled_day', level: 'warning' }),
      expect.objectContaining({ code: 'effective_vehicle_omitted', level: 'warning' }),
      expect.objectContaining({ code: 'low_confidence_aoi', level: 'warning' }),
    ]));
  });
});
