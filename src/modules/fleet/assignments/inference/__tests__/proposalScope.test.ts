import { describe, it, expect } from 'vitest';
import { canActOnProposal, canDecideProposal, scopeProposals } from '../proposalScope';
import type { SiteInferenceProposal } from '../proposalQueries';

const MINE = 'p-mine';
const THEIRS = 'p-theirs';

function proposal(overrides: Partial<SiteInferenceProposal> = {}): SiteInferenceProposal {
  return {
    vehicleId: 'v1', registration: 'MW94RBGP', outcome: 'confident',
    inferredProjectId: MINE, inferredProjectName: 'Lawley', dominantShare: 0.84,
    pings: 100, dwellSeconds: 1000, distinctDays: 10, totalPositions: 120,
    windowStart: '2026-07-17T00:00:00.000Z', windowEnd: '2026-08-21T00:00:00.000Z',
    breakdown: [
      { projectId: MINE, projectName: 'Lawley', pings: 80, dwellSeconds: 840, distinctDays: 10, share: 0.84 },
      { projectId: THEIRS, projectName: 'Mohadin', pings: 20, dwellSeconds: 160, distinctDays: 3, share: 0.16 },
    ],
    computedAt: '2026-08-21T00:00:00.000Z', decision: null, decidedProjectId: null,
    decidedProjectName: null, decidedFrom: null, note: null, decidedBy: null, decidedAt: null,
    decisionMatchesInference: null, effectiveProjectId: MINE, appliedAssignmentId: null,
    appliedAt: null, drivers: [],
    ...overrides,
  };
}

describe('scopeProposals', () => {
  it('returns everything untouched for an all-projects actor', () => {
    const rows = [proposal()];
    expect(scopeProposals(rows, [], true)).toBe(rows);
  });

  it('drops the breakdown entries for projects the actor cannot see', () => {
    const [scoped] = scopeProposals([proposal()], [MINE], false);
    expect(scoped.breakdown.map((entry) => entry.projectId)).toEqual([MINE]);
    expect(scoped.inferredProjectId).toBe(MINE);
  });

  it('hides a proposal that names only projects the actor cannot see', () => {
    const hidden = proposal({
      inferredProjectId: THEIRS, inferredProjectName: 'Mohadin', effectiveProjectId: THEIRS,
      breakdown: [{ projectId: THEIRS, projectName: 'Mohadin', pings: 100, dwellSeconds: 1000, distinctDays: 10, share: 1 }],
    });
    expect(scopeProposals([hidden], [MINE], false)).toEqual([]);
  });

  it('masks the inferred project when the row survives on a breakdown entry alone', () => {
    // Vehicle mostly on someone else's project but with a visible slice: the
    // row is legitimately visible, the other project's name is not.
    const mixed = proposal({
      inferredProjectId: THEIRS, inferredProjectName: 'Mohadin', effectiveProjectId: THEIRS,
    });
    const [scoped] = scopeProposals([mixed], [MINE], false);
    expect(scoped.inferredProjectId).toBeNull();
    expect(scoped.inferredProjectName).toBeNull();
    expect(scoped.effectiveProjectId).toBeNull();
    expect(scoped.breakdown.map((entry) => entry.projectId)).toEqual([MINE]);
  });

  it('masks a decided project the actor cannot see', () => {
    const decided = proposal({
      decision: 'assigned', decidedProjectId: THEIRS, decidedProjectName: 'Mohadin',
      decidedFrom: 'override', effectiveProjectId: THEIRS,
    });
    const [scoped] = scopeProposals([decided], [MINE], false);
    expect(scoped.decidedProjectId).toBeNull();
    expect(scoped.decidedProjectName).toBeNull();
  });

  // DOCUMENTED LIMITATION, not an oversight: a vehicle with no GPS names no
  // project, so there is nothing to scope it by, and showing it would disclose
  // the existence of vehicles and drivers company-wide to a project-scoped
  // manager. The 6 drivers whose vehicles never report are therefore visible to
  // all-projects actors only. If that needs to change, scoping has to run off
  // staff visibility rather than project ids.
  it('hides a project-less proposal from a scoped actor rather than leaking the fleet', () => {
    const noProject = proposal({
      outcome: 'no_aoi_coverage', inferredProjectId: null, inferredProjectName: null,
      effectiveProjectId: null, breakdown: [],
    });
    expect(scopeProposals([noProject], [MINE], false)).toEqual([]);
  });
});

describe('canActOnProposal / canDecideProposal', () => {
  const ADMIN = { allProjects: true };
  const SCOPED = { allProjects: false, authorizedProjectIds: [MINE] };

  it('lets an all-projects actor act on a project that is no longer active', () => {
    // canEditAssignmentProject applies `status = 'active'` BEFORE its admin
    // branch, so routing through it froze any decision on a deactivated project
    // with no way back for anyone. allProjects carries no such rule.
    expect(canActOnProposal({ decidedProjectId: 'a-deactivated-project' }, ADMIN)).toBe(true);
  });

  it('lets a scoped actor apply an override to a project they own', () => {
    // The machine guessed THEIRS; the person overrode to MINE. Authorizing the
    // inferred project too would block the one case overrides exist for.
    expect(canActOnProposal({ decidedProjectId: MINE }, SCOPED)).toBe(true);
  });

  it('refuses a scoped actor applying to a project they do not own', () => {
    expect(canActOnProposal({ decidedProjectId: THEIRS }, SCOPED)).toBe(false);
  });

  it('refuses a scoped actor when there is no decided project to target', () => {
    // The `no target` branch: admin only.
    expect(canActOnProposal({ decidedProjectId: null }, SCOPED)).toBe(false);
    expect(canActOnProposal({ decidedProjectId: null }, ADMIN)).toBe(true);
  });

  it('treats an absent allProjects flag as restrictive, never permissive', () => {
    // ActorScope.allProjects is optional, so undefined must fail closed.
    expect(canActOnProposal({ decidedProjectId: MINE }, {})).toBe(false);
    expect(canDecideProposal({ decidedProjectId: MINE, inferredProjectId: MINE }, MINE, {}))
      .toBe(false);
  });

  it('requires BOTH projects to decide, unlike applying', () => {
    const contested = { decidedProjectId: THEIRS, inferredProjectId: MINE };
    // Someone else already decided this onto a project the actor cannot see.
    expect(canDecideProposal(contested, MINE, SCOPED)).toBe(false);
    // But applying only writes to the decided project, so the rules differ on
    // purpose - this is the asymmetry, pinned.
    expect(canActOnProposal({ decidedProjectId: MINE }, SCOPED)).toBe(true);
  });

  it('falls back to the inferred project when a decision names none', () => {
    const undecided = { decidedProjectId: null, inferredProjectId: MINE };
    expect(canDecideProposal(undecided, null, SCOPED)).toBe(true);
    expect(canDecideProposal({ decidedProjectId: null, inferredProjectId: THEIRS }, null, SCOPED))
      .toBe(false);
  });

  it('refuses a scoped actor deciding a proposal with no project at all', () => {
    // The `touched.length === 0` branch: admin only.
    const bare = { decidedProjectId: null, inferredProjectId: null };
    expect(canDecideProposal(bare, null, SCOPED)).toBe(false);
    expect(canDecideProposal(bare, null, ADMIN)).toBe(true);
  });
});
