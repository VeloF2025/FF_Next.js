/**
 * Manager incident-review façade: the one import surface the
 * `pages/api/fleet/incidents/**` routes use. Composes the split-out
 * modules — `reviewScope` (permission/project scope), `reviewQueries`
 * (list/detail reads), and `reviewTransitions` (transactional lifecycle
 * writes) — kept separate to hold each file under the project's 300-line
 * cap (this task's brief explicitly allows and asks for that split to be
 * explained; see the Task 6 report).
 *
 * The one piece of orchestration that belongs here rather than in
 * `reviewTransitions`: sending the terminal `sendResolutionNotification`
 * strictly *after* `runIncidentTransition`'s transaction has already
 * resolved (committed) — never from inside it.
 */
import { IncidentNotFoundError } from './incidentRepository';
import { sendResolutionNotification } from './incidentNotifications';
import { isProjectOwnedByScope, resolveIncidentScope } from './reviewScope';
import {
  getIncidentActions, getIncidentCore, getIncidentCorrectionLinks, getIncidentDeliverySummary,
  getIncidentDriverInputSummary, getIncidentEvidence, listIncidents,
} from './reviewQueries';
import { runBulkAcknowledge, runIncidentTransition, type BulkAcknowledgeOutcome } from './reviewTransitions';
import type {
  IncidentDetail, IncidentListRequest, IncidentListResult, IncidentTransitionRequest, IncidentTransitionResult,
} from './types';

export { IncidentNotFoundError };

export class IncidentAccessDeniedError extends Error {
  constructor(message = 'You cannot access this Fleet incident') { super(message); this.name = 'IncidentAccessDeniedError'; }
}

export interface IncidentViewer { userId: string; staffId: string | null; role: string }

export async function listIncidentsForViewer(request: IncidentListRequest, viewer: IncidentViewer): Promise<IncidentListResult> {
  const scope = await resolveIncidentScope(viewer.userId, viewer.staffId, viewer.role, 'view');
  if (!scope) throw new IncidentAccessDeniedError('You cannot view Fleet incidents');
  return listIncidents(request, scope);
}

export async function getIncidentDetailForViewer(incidentId: string, viewer: IncidentViewer): Promise<IncidentDetail> {
  const scope = await resolveIncidentScope(viewer.userId, viewer.staffId, viewer.role, 'view');
  if (!scope) throw new IncidentAccessDeniedError('You cannot view Fleet incidents');
  const core = await getIncidentCore(incidentId);
  if (!core) throw new IncidentNotFoundError(`No incident found for id ${incidentId}`);
  if (!scope.unrestricted && !await isProjectOwnedByScope(scope, core.projectId)) throw new IncidentAccessDeniedError('You cannot view this Fleet incident');
  // Every read below runs behind the same project-scope gate just checked above — including
  // `driverInput`/`correctionLinks` (PR7 review C1: "reuse the existing enforcement ...
  // rather than adding a second scope check").
  const now = new Date().toISOString();
  const [actions, evidence, delivery, driverInput, correctionLinks] = await Promise.all([
    getIncidentActions(incidentId), getIncidentEvidence(incidentId), getIncidentDeliverySummary(incidentId),
    getIncidentDriverInputSummary(incidentId, core.resolvedAt, now), getIncidentCorrectionLinks(incidentId),
  ]);
  return { ...core, actions, evidence, delivery, driverInput, correctionLinks };
}

export async function transitionIncident(request: IncidentTransitionRequest, viewer: IncidentViewer): Promise<IncidentTransitionResult> {
  const scope = await resolveIncidentScope(viewer.userId, viewer.staffId, viewer.role, 'edit');
  if (!scope) throw new IncidentAccessDeniedError('You cannot act on Fleet incidents');
  const core = await getIncidentCore(request.incidentId);
  if (!core) throw new IncidentNotFoundError(`No incident found for id ${request.incidentId}`);
  if (!scope.unrestricted && !await isProjectOwnedByScope(scope, core.projectId)) throw new IncidentAccessDeniedError('You cannot act on this Fleet incident');
  const outcome = await runIncidentTransition(request);
  if (outcome.notify) await sendResolutionNotification(outcome.notify);
  return outcome.result;
}

export async function bulkAcknowledgeIncidents(
  incidentIds: string[], viewer: IncidentViewer, requestCorrelationId: string | null,
): Promise<BulkAcknowledgeOutcome> {
  const scope = await resolveIncidentScope(viewer.userId, viewer.staffId, viewer.role, 'edit');
  if (!scope) throw new IncidentAccessDeniedError('You cannot act on Fleet incidents');
  return runBulkAcknowledge(incidentIds, viewer.userId, scope, requestCorrelationId);
}
