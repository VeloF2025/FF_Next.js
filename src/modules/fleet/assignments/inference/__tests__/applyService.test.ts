import { describe, it, expect, vi, beforeEach } from 'vitest';

const previewAssignments = vi.fn();
const commitAssignments = vi.fn();
const endAssignment = vi.fn();
const listProjectSites = vi.fn();
const getProposal = vi.fn();
const markApplied = vi.fn();
const clearApplied = vi.fn();

vi.mock('../../bulkAssignmentService', () => ({
  previewAssignments: (...args: unknown[]) => previewAssignments(...args),
  commitAssignments: (...args: unknown[]) => commitAssignments(...args),
  endAssignment: (...args: unknown[]) => endAssignment(...args),
}));
vi.mock('../../projectSiteQueries', () => ({
  listProjectSites: (...args: unknown[]) => listProjectSites(...args),
}));
vi.mock('../proposalQueries', () => ({ getProposal: (...args: unknown[]) => getProposal(...args) }));
vi.mock('../proposalRepository', () => ({
  markApplied: (...args: unknown[]) => markApplied(...args),
  clearApplied: (...args: unknown[]) => clearApplied(...args),
}));

import { applyProposal, revertProposal, ApplyProposalError } from '../applyService';

const VEHICLE = 'aaaaaaaa-0000-0000-0000-000000000001';
const PROJECT = 'aaaaaaaa-0000-0000-0000-000000000002';
const STAFF = 'aaaaaaaa-0000-0000-0000-000000000003';
const SITE = 'aaaaaaaa-0000-0000-0000-000000000004';
const VEHICLE_ASSIGNMENT = 'aaaaaaaa-0000-0000-0000-000000000005';
const ACTOR = { userId: 'aaaaaaaa-0000-0000-0000-0000000000ff', role: 'admin' };
const SCOPE = { allProjects: true };
const RANGE = { startDate: '2026-08-01', endDate: '2026-12-31' };

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    vehicleId: VEHICLE, registration: 'MW94RBGP', outcome: 'confident',
    decision: 'assigned', decidedProjectId: PROJECT, decidedFrom: 'inference',
    appliedAssignmentId: null,
    drivers: [{ staffId: STAFF, staffName: 'Marthinus Van De Venter',
      vehicleAssignmentId: VEHICLE_ASSIGNMENT, assignmentRegistration: 'EMN889GP' }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getProposal.mockResolvedValue(proposal());
  listProjectSites.mockResolvedValue([
    { id: SITE, projectId: PROJECT, displayName: 'Lawley', isDefault: true, isActive: true },
  ]);
  previewAssignments.mockResolvedValue({ conflicts: [], fingerprint: 'fp-1' });
  commitAssignments.mockResolvedValue({ batchId: 'b1', assignmentIds: ['assign-1'] });
});

describe('applyProposal', () => {
  it('commits through the existing assignment service and records the result', async () => {
    const result = await applyProposal(VEHICLE, RANGE, SCOPE, ACTOR);
    expect(result.assignmentId).toBe('assign-1');

    const [committed, fingerprint, actor] = commitAssignments.mock.calls[0];
    expect(fingerprint).toBe('fp-1');
    expect(actor).toEqual(ACTOR);
    expect(committed.rows).toEqual([{
      staffId: STAFF, projectId: PROJECT, operationalSiteId: SITE,
      startDate: '2026-08-01', endDate: '2026-12-31', assignmentKind: 'roster',
      vehicleAssignmentId: VEHICLE_ASSIGNMENT,
      reason: 'GPS site inference proposal accepted for MW94RBGP',
    }]);
    expect(markApplied).toHaveBeenCalledWith(VEHICLE, 'assign-1', ACTOR.userId);
  });

  it('refuses a proposal no human has assigned', async () => {
    getProposal.mockResolvedValue(proposal({ decision: null, decidedProjectId: null }));
    await expect(applyProposal(VEHICLE, RANGE, SCOPE, ACTOR))
      .rejects.toMatchObject({ code: 'not_assigned' });
    expect(commitAssignments).not.toHaveBeenCalled();
  });

  it('refuses a roaming_confirmed proposal', async () => {
    getProposal.mockResolvedValue(
      proposal({ decision: 'roaming_confirmed', decidedProjectId: null }));
    await expect(applyProposal(VEHICLE, RANGE, SCOPE, ACTOR))
      .rejects.toMatchObject({ code: 'not_assigned' });
  });

  it('refuses a non-assigned decision even if a project somehow rides along', async () => {
    // Migration 522's CHECK stops this shape reaching the table, so the two
    // cases above both have a null project and never exercise the decision
    // half of the guard. This one hands the service the shape directly, so the
    // service does not silently depend on that constraint staying put.
    getProposal.mockResolvedValue(
      proposal({ decision: 'rejected', decidedProjectId: PROJECT }));
    await expect(applyProposal(VEHICLE, RANGE, SCOPE, ACTOR))
      .rejects.toMatchObject({ code: 'not_assigned' });
    expect(commitAssignments).not.toHaveBeenCalled();
  });

  it('refuses to apply the same proposal twice', async () => {
    getProposal.mockResolvedValue(proposal({ appliedAssignmentId: 'assign-0' }));
    await expect(applyProposal(VEHICLE, RANGE, SCOPE, ACTOR))
      .rejects.toMatchObject({ code: 'already_applied' });
    expect(commitAssignments).not.toHaveBeenCalled();
  });

  it('refuses a vehicle with no current driver instead of guessing one', async () => {
    getProposal.mockResolvedValue(proposal({ drivers: [] }));
    await expect(applyProposal(VEHICLE, RANGE, SCOPE, ACTOR))
      .rejects.toMatchObject({ code: 'no_driver' });
  });

  it('refuses a vehicle with several current drivers instead of picking one', async () => {
    getProposal.mockResolvedValue(proposal({ drivers: [
      { staffId: STAFF, staffName: 'A', vehicleAssignmentId: 'va1', assignmentRegistration: 'X' },
      { staffId: 'other', staffName: 'B', vehicleAssignmentId: 'va2', assignmentRegistration: 'Y' },
    ] }));
    await expect(applyProposal(VEHICLE, RANGE, SCOPE, ACTOR))
      .rejects.toMatchObject({ code: 'ambiguous_driver' });
  });

  it('names the project when it has no operational site to assign into', async () => {
    listProjectSites.mockResolvedValue([]);
    const error = await applyProposal(VEHICLE, RANGE, SCOPE, ACTOR).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApplyProposalError);
    expect(error.code).toBe('no_site_for_project');
    expect(commitAssignments).not.toHaveBeenCalled();
  });

  it('prefers the default site when a project has several', async () => {
    listProjectSites.mockResolvedValue([
      { id: 'site-other', projectId: PROJECT, displayName: 'Depot', isDefault: false, isActive: true },
      { id: SITE, projectId: PROJECT, displayName: 'Lawley', isDefault: true, isActive: true },
    ]);
    await applyProposal(VEHICLE, RANGE, SCOPE, ACTOR);
    expect(commitAssignments.mock.calls[0][0].rows[0].operationalSiteId).toBe(SITE);
  });

  it('stops on a blocking conflict rather than committing it', async () => {
    previewAssignments.mockResolvedValue({
      conflicts: [{ rowIndex: 0, code: 'overlap', level: 'blocking', field: null, message: 'x' }],
      fingerprint: 'fp-1',
    });
    await expect(applyProposal(VEHICLE, RANGE, SCOPE, ACTOR))
      .rejects.toMatchObject({ code: 'blocking_conflicts' });
    expect(commitAssignments).not.toHaveBeenCalled();
    expect(markApplied).not.toHaveBeenCalled();
  });

  it('refuses to apply over roster warnings the caller has not seen', async () => {
    previewAssignments.mockResolvedValue({
      conflicts: [{ rowIndex: 0, code: 'no_schedule', level: 'warning', field: null,
        message: 'Staff has no schedule for this range' }],
      fingerprint: 'fp-1',
    });
    const error = await applyProposal(VEHICLE, RANGE, SCOPE, ACTOR).catch((caught) => caught);
    expect(error.code).toBe('unconfirmed_warnings');
    expect(error.message).toContain('Staff has no schedule for this range');
    expect(commitAssignments).not.toHaveBeenCalled();
  });

  it('applies over warnings once the caller confirms them', async () => {
    previewAssignments.mockResolvedValue({
      conflicts: [{ rowIndex: 0, code: 'no_schedule', level: 'warning', field: null, message: 'x' }],
      fingerprint: 'fp-1',
    });
    await applyProposal(VEHICLE, { ...RANGE, confirmWarnings: true }, SCOPE, ACTOR);
    expect(commitAssignments.mock.calls[0][0].confirmedWarnings).toBe(true);
  });

  it('does not claim confirmation on a clean preview', async () => {
    // confirmedWarnings: true unconditionally would be a standing override of a
    // gate the roster service owns.
    await applyProposal(VEHICLE, { ...RANGE, confirmWarnings: true }, SCOPE, ACTOR);
    expect(commitAssignments.mock.calls[0][0].confirmedWarnings).toBe(false);
  });

  it('does not record the application when the commit throws', async () => {
    commitAssignments.mockRejectedValue(new Error('overlap'));
    await expect(applyProposal(VEHICLE, RANGE, SCOPE, ACTOR)).rejects.toThrow('overlap');
    expect(markApplied).not.toHaveBeenCalled();
  });
});

describe('project scope', () => {
  const SCOPED = { allProjects: false, authorizedProjectIds: ['some-other-project'] };

  it('refuses to apply before it resolves a driver or a site', async () => {
    getProposal.mockResolvedValue(proposal({ drivers: [] }));
    const error = await applyProposal(VEHICLE, RANGE, SCOPED, ACTOR).catch((caught) => caught);
    // Not `no_driver`: that answer would confirm the vehicle and its project
    // exist to someone who may not see either.
    expect(error.code).toBe('out_of_scope');
    expect(error.status).toBe(404);
    expect(listProjectSites).not.toHaveBeenCalled();
    expect(previewAssignments).not.toHaveBeenCalled();
  });

  it('refuses to revert outside scope', async () => {
    getProposal.mockResolvedValue(proposal({ appliedAssignmentId: 'assign-1' }));
    await expect(revertProposal(VEHICLE, '2026-08-05', SCOPED, ACTOR))
      .rejects.toMatchObject({ code: 'out_of_scope' });
    expect(endAssignment).not.toHaveBeenCalled();
  });

  it('allows a scoped actor whose scope covers the proposal', async () => {
    await applyProposal(VEHICLE, RANGE,
      { allProjects: false, authorizedProjectIds: [PROJECT] }, ACTOR);
    expect(commitAssignments).toHaveBeenCalled();
  });
});

describe('revertProposal', () => {
  it('ends the assignment it created and clears the applied stamp', async () => {
    getProposal.mockResolvedValue(proposal({ appliedAssignmentId: 'assign-1' }));
    endAssignment.mockResolvedValue({ id: 'assign-1' });
    await revertProposal(VEHICLE, '2026-08-05', SCOPE, ACTOR);
    expect(endAssignment).toHaveBeenCalledWith('assign-1',
      { endDate: '2026-08-05', reason: 'GPS site inference application reverted' }, ACTOR);
    expect(clearApplied).toHaveBeenCalledWith(VEHICLE);
  });

  it('refuses to revert something that was never applied', async () => {
    await expect(revertProposal(VEHICLE, '2026-08-05', SCOPE, ACTOR))
      .rejects.toMatchObject({ code: 'not_applied' });
    expect(endAssignment).not.toHaveBeenCalled();
  });

  it('leaves the stamp in place when ending the assignment fails', async () => {
    getProposal.mockResolvedValue(proposal({ appliedAssignmentId: 'assign-1' }));
    endAssignment.mockRejectedValue(new Error('not active'));
    await expect(revertProposal(VEHICLE, '2026-08-05', SCOPE, ACTOR)).rejects.toThrow('not active');
    expect(clearApplied).not.toHaveBeenCalled();
  });
});
