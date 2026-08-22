import type { SiteInferenceProposal } from './proposalQueries';

/**
 * Narrows proposals to what the asking user may see.
 *
 * A proposal's evidence names every project a vehicle dwelled in, so handing a
 * project-scoped manager the raw list would tell them which other projects
 * exist and how much time a vehicle spent there. Both the row filter and the
 * breakdown redaction are needed: filtering alone still leaks the breakdown of
 * any row that survives.
 */
export function scopeProposals(
  proposals: SiteInferenceProposal[],
  authorizedProjectIds: string[],
  allProjects: boolean,
): SiteInferenceProposal[] {
  if (allProjects) return proposals;
  const permitted = new Set(authorizedProjectIds);
  const visible: SiteInferenceProposal[] = [];
  for (const proposal of proposals) {
    const breakdown = proposal.breakdown.filter((entry) => permitted.has(entry.projectId));
    const namesPermitted = [proposal.inferredProjectId, proposal.decidedProjectId]
      .some((projectId) => projectId !== null && permitted.has(projectId));
    if (!namesPermitted && breakdown.length === 0) continue;
    visible.push({
      ...proposal,
      breakdown,
      inferredProjectId: maskProject(proposal.inferredProjectId, permitted),
      inferredProjectName: maskName(proposal.inferredProjectId, proposal.inferredProjectName, permitted),
      decidedProjectId: maskProject(proposal.decidedProjectId, permitted),
      decidedProjectName: maskName(proposal.decidedProjectId, proposal.decidedProjectName, permitted),
      effectiveProjectId: maskProject(proposal.effectiveProjectId, permitted),
    });
  }
  return visible;
}

function maskProject(projectId: string | null, permitted: Set<string>): string | null {
  return projectId !== null && permitted.has(projectId) ? projectId : null;
}

function maskName(
  projectId: string | null,
  projectName: string | null,
  permitted: Set<string>,
): string | null {
  return projectId !== null && permitted.has(projectId) ? projectName : null;
}

/** What the route forwards to the roster service, and now also gates on. */
export interface ProposalActorScope {
  /** Optional to mirror ActorScope. Absent means restrictive, never permissive. */
  allProjects?: boolean;
  authorizedProjectIds?: string[];
}

/**
 * The project an apply or revert actually writes to.
 *
 * The inferred project is EVIDENCE, not a target. Authorizing against it broke
 * the one case the override mechanism exists for: a person moving a vehicle to
 * a project they own, after the machine guessed one they do not.
 */
export function proposalTargetProjectId(
  proposal: Pick<SiteInferenceProposal, 'decidedProjectId'>,
): string | null {
  return proposal.decidedProjectId;
}

/**
 * Authorizes an apply or a revert.
 *
 * Deliberately gates on the forwarded scope rather than canEditAssignmentProject.
 * That helper enforces `projects.status = 'active'` BEFORE its admin branch, so
 * once a project stops being active nobody at all - administrators included -
 * could revert a decision recorded against it. The decision froze with no path
 * back. `allProjects` is role-derived and carries no such rule, so an
 * administrator can always unwind their own fleet.
 */
export function canActOnProposal(
  proposal: Pick<SiteInferenceProposal, 'decidedProjectId'>,
  scope: ProposalActorScope,
): boolean {
  if (scope.allProjects === true) return true;
  const target = proposalTargetProjectId(proposal);
  if (target === null) return false;
  return new Set(scope.authorizedProjectIds ?? []).has(target);
}

/**
 * Authorizes a decision.
 *
 * Stricter than canActOnProposal ON PURPOSE, and the difference is the point:
 * deciding can overwrite an answer someone else already gave, so the project an
 * existing decision points at must be authorized too, or it could be taken over
 * by someone who cannot see it. Applying only writes to the decided project, so
 * demanding more there blocks legitimate overrides for no security gain.
 */
export function canDecideProposal(
  proposal: Pick<SiteInferenceProposal, 'decidedProjectId' | 'inferredProjectId'>,
  targetProjectId: string | null,
  scope: ProposalActorScope,
): boolean {
  if (scope.allProjects === true) return true;
  const touched = [targetProjectId ?? proposal.inferredProjectId, proposal.decidedProjectId]
    .filter((projectId): projectId is string => typeof projectId === 'string');
  if (touched.length === 0) return false;
  const permitted = new Set(scope.authorizedProjectIds ?? []);
  return touched.every((projectId) => permitted.has(projectId));
}
