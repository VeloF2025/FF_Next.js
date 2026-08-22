import { log } from '@/lib/logger';
import { commitAssignments, endAssignment, previewAssignments } from '../bulkAssignmentService';
import { listProjectSites } from '../projectSiteQueries';
import type { AssignmentActor, ActorScope } from '../assignmentQueries';
import type { AssignmentProposalRow } from '../types';
import { getProposal, type SiteInferenceProposal } from './proposalQueries';
import { clearApplied, markApplied } from './proposalRepository';

/**
 * Pushes an accepted proposal onto the roster - explicitly, one vehicle at a
 * time, never as a side effect of a recompute.
 *
 * The write itself goes through commitAssignments rather than a parallel
 * INSERT, so the roster's overlap exclusion constraints, project snapshots and
 * audit trail all apply exactly as they do for a hand-entered assignment.
 */

export type ApplyProposalCode =
  | 'unknown_proposal'
  | 'not_assigned'
  | 'already_applied'
  | 'no_driver'
  | 'ambiguous_driver'
  | 'no_site_for_project'
  | 'blocking_conflicts'
  | 'unconfirmed_warnings'
  | 'not_applied';

export class ApplyProposalError extends Error {
  constructor(
    public readonly code: ApplyProposalCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApplyProposalError';
  }
}

export interface ApplyDateRange {
  startDate: string;
  endDate: string;
  /**
   * Blanket-confirming the roster's warnings would hide exactly the things a
   * person applying a machine's guess most needs to see, so the caller has to
   * come back and say yes to them by name.
   */
  confirmWarnings?: boolean;
}

export interface ApplyResult {
  vehicleId: string;
  assignmentId: string;
  staffId: string;
  projectId: string;
  operationalSiteId: string;
}

async function requireProposal(vehicleId: string): Promise<SiteInferenceProposal> {
  const proposal = await getProposal(vehicleId);
  if (!proposal) {
    throw new ApplyProposalError('unknown_proposal', 'No proposal exists for that vehicle', 404);
  }
  return proposal;
}

export async function applyProposal(
  vehicleId: string,
  range: ApplyDateRange,
  scope: ActorScope,
  actor: AssignmentActor,
): Promise<ApplyResult> {
  const proposal = await requireProposal(vehicleId);
  const projectId = proposal.decidedProjectId;
  if (proposal.decision !== 'assigned' || projectId === null) {
    throw new ApplyProposalError(
      'not_assigned',
      'Only a proposal a person has assigned to a project can be applied',
      409,
    );
  }
  if (proposal.appliedAssignmentId !== null) {
    throw new ApplyProposalError(
      'already_applied', 'That proposal has already been applied', 409);
  }

  const driver = resolveDriver(proposal);
  const operationalSiteId = await resolveSite(projectId);

  const row: AssignmentProposalRow = {
    staffId: driver.staffId,
    projectId,
    operationalSiteId,
    startDate: range.startDate,
    endDate: range.endDate,
    assignmentKind: 'roster',
    vehicleAssignmentId: driver.vehicleAssignmentId,
    reason: `GPS site inference proposal accepted for ${proposal.registration}`,
  };

  const preview = await previewAssignments({ rows: [row] }, scope);
  if (preview.conflicts.some((conflict) => conflict.level === 'blocking')) {
    throw new ApplyProposalError(
      'blocking_conflicts',
      'The roster rejected this assignment; resolve the conflicts first',
      409,
    );
  }

  const warnings = preview.conflicts.filter((conflict) => conflict.level === 'warning');
  if (warnings.length > 0 && range.confirmWarnings !== true) {
    throw new ApplyProposalError(
      'unconfirmed_warnings',
      `The roster raised warnings: ${warnings.map((warning) => warning.message).join('; ')}`,
      409,
    );
  }

  const committed = await commitAssignments(
    { rows: [row], confirmedWarnings: warnings.length > 0 }, preview.fingerprint, actor);
  const assignmentId = committed.assignmentIds[0];
  if (!assignmentId) {
    throw new ApplyProposalError(
      'blocking_conflicts', 'The roster returned no assignment', 409);
  }
  // Only after the roster write landed. Ordering matters: the stamp claiming an
  // assignment that does not exist is worse than no stamp.
  await markApplied(vehicleId, assignmentId, actor.userId);
  log.info('Applied fleet site inference proposal', {
    vehicleId, projectId, assignmentId, staffId: driver.staffId,
  }, 'fleet');
  return { vehicleId, assignmentId, staffId: driver.staffId, projectId, operationalSiteId };
}

function resolveDriver(proposal: SiteInferenceProposal) {
  const [driver, ...rest] = proposal.drivers;
  if (!driver) {
    throw new ApplyProposalError(
      'no_driver',
      `${proposal.registration} has no current driver; assign one before applying`,
      409,
    );
  }
  if (rest.length > 0) {
    // Guessing here would put one named person on a roster on GPS evidence that
    // belongs to several. The human picks.
    throw new ApplyProposalError(
      'ambiguous_driver',
      `${proposal.registration} has ${proposal.drivers.length} current drivers; `
        + 'assign the roster entry by hand',
      409,
    );
  }
  return driver;
}

async function resolveSite(projectId: string): Promise<string> {
  const sites = await listProjectSites(projectId, false);
  const site = sites.find((entry) => entry.isDefault) ?? sites[0];
  if (!site) {
    throw new ApplyProposalError(
      'no_site_for_project',
      'That project has no active operational site. Create one on the Assignments '
        + 'page first - inference names a project, not a site.',
      409,
    );
  }
  return site.id;
}

/** Undoes an application: ends the roster entry, then clears the stamp. */
export async function revertProposal(
  vehicleId: string,
  endDate: string,
  actor: AssignmentActor,
): Promise<void> {
  const proposal = await requireProposal(vehicleId);
  const assignmentId = proposal.appliedAssignmentId;
  if (assignmentId === null) {
    throw new ApplyProposalError('not_applied', 'That proposal has not been applied', 409);
  }
  await endAssignment(
    assignmentId, { endDate, reason: 'GPS site inference application reverted' }, actor);
  await clearApplied(vehicleId);
  log.info('Reverted fleet site inference application', { vehicleId, assignmentId }, 'fleet');
}
