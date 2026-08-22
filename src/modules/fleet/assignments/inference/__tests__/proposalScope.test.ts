import { describe, it, expect } from 'vitest';
import { scopeProposals } from '../proposalScope';
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

  it('keeps a proposal with no project at all only when its breakdown has one', () => {
    const noProject = proposal({
      outcome: 'no_aoi_coverage', inferredProjectId: null, inferredProjectName: null,
      effectiveProjectId: null, breakdown: [],
    });
    expect(scopeProposals([noProject], [MINE], false)).toEqual([]);
  });
});
