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
