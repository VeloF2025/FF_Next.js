/**
 * Five-minute roster/status-to-incident orchestration (design §8.1).
 *
 * Loads every active project's complete PR 4 roster/status output through
 * the merged `completeRosterLoading`/`statusService` public API — that API
 * is project-scoped by contract (no system-wide call exists), so "one PR4
 * roster/status load per tick" means one roster-loading *phase*: every
 * active project is loaded as a single unit, and if any one of those calls
 * throws, the whole phase is treated as a systemic failure (never partial)
 * so a broken evidence source can never silently look like "nothing to
 * report" for the projects it didn't get to.
 *
 * Each staff row is then evaluated independently through `incidentProducer`.
 * `resolveScheduledIncidentType` (Task 3) is reused rather than
 * re-deriving PR6's four-status mapping here.
 *
 * Condition clearing (Task 5): a staff row whose current status does NOT
 * map to one of the four scheduled incident types is checked for healthy
 * clearing of any still-open incident of those four types. "Healthy" is
 * deliberately narrow and conservative — Task 4 correctly flagged that
 * deriving "evidence is healthy" from the roster *summary* is a
 * safety-relevant judgment, so this only clears when BOTH:
 *   - the current status is one of the two PR4 statuses that mean "evidence
 *     positively confirms presence at the right place" (`attendance_confirmed`,
 *     `on_site_dual`) — not merely "not currently flagged as one of the four
 *     problem types" (e.g. `off_duty`, `approaching`, `scheduled_not_due`
 *     say nothing positive about evidence and never clear); and
 *   - the evaluation carries no flags at all (any flag — stale/missing GPS,
 *     missing attendance, low-confidence geometry, a pending confirmation,
 *     etc. — is itself evidence uncertainty and blocks clearing).
 * `evaluateConditionClearing` (Task 3) is itself the final safety gate: it
 * only ever sets `condition_cleared_at`, never resolves/dismisses, and is a
 * safe no-op when there is no matching open incident.
 *
 * `ScheduledIncidentProducerRequest` (Task 3's authoritative contract) has
 * no dedicated monitor-run field — only `requestCorrelationId`. Rather than
 * widen that contract (out of this task's exact file scope), the run id is
 * threaded through as `requestCorrelationId`, which `incidentProducer`
 * already stores on the `opened`/`condition_cleared` actions' correlation
 * column, giving action-to-run traceability without touching Task 3's files.
 *
 * Initial "opened" notifications are sent through `incidentNotifications`
 * (Task 5), which resolves recipients via `recipientService` — the ONE
 * recipient-resolution path for PR6. This supersedes the interim,
 * self-contained project-manager-only lookup this module carried while
 * Task 5 did not exist yet.
 */
import { log } from '@/lib/logger';
import { query } from '@/lib/db-pool';
import { loadCompleteOperationalRoster } from '../operations/completeRosterLoading';
import type { OperationalStatus, OperationalStatusSummary } from '../operations/types';
import { sastDateString } from '../parking/sastDate';
import { finalizeMonitorRun, startMonitorRun } from './runRepository';
import { loadEffectiveIncidentRule } from './settingsRepository';
import { evaluateConditionClearing, produceIncident, resolveScheduledIncidentType } from './incidentProducer';
import { buildAssignmentIdentity, computeObservationFingerprint } from './observationFingerprint';
import { sendIncidentOpenedNotification } from './incidentNotifications';
import type {
  IncidentMonitorRequest, IncidentMonitorResult, IncidentRule,
  ScheduledIncidentProducerRequest, ScheduledIncidentType,
} from './types';

const MODULE = 'FleetOperationalMonitor';
const SCHEDULED_TYPES: readonly ScheduledIncidentType[] = ['late', 'wrong_site', 'evidence_mismatch', 'left_early'];
const MAX_ERROR_SUMMARY_LENGTH = 2000;
const MAX_ERROR_ENTRIES = 20;
// See module docblock: the only two PR4 statuses that positively confirm
// evidence, as opposed to merely not (yet) flagging a problem.
const HEALTHY_CLEARING_STATUSES: readonly OperationalStatus[] = ['attendance_confirmed', 'on_site_dual'];

interface ProjectIdRow extends Record<string, unknown> { id: string }

/** No system-wide "monitored roster" call exists (statusService is always project-scoped); this discovers the projects to iterate. Mirrors the exact "active" definition already used by `operations/projectScope.ts`. */
async function loadActiveProjectIds(): Promise<string[]> {
  const rows = await query<ProjectIdRow>(
    `/* fleet-operational-monitor:active-projects */ SELECT id FROM projects WHERE LOWER(status) = 'active' ORDER BY id`,
  );
  return rows.map((row) => row.id);
}

/**
 * The whole roster-loading phase for one tick. A failure anywhere in it
 * (project discovery or any one project's roster call) is systemic: the
 * caller must never partially process a roster it could not fully load.
 *
 * Exported so `incidentSummaryPhase`'s morning-summary phase reuses this
 * exact "enumerate active projects, load each project's complete roster"
 * definition instead of re-deriving it — there is exactly one definition of
 * "the monitored roster" for PR6.
 */
export async function loadMonitoredRoster(workDate: string, effectiveAt: string): Promise<OperationalStatusSummary[]> {
  const projectIds = await loadActiveProjectIds();
  const items: OperationalStatusSummary[] = [];
  for (const projectId of projectIds) {
    const page = await loadCompleteOperationalRoster({ projectId, workDate, asOf: effectiveAt });
    items.push(...page.items);
  }
  return items;
}

async function loadScheduledRules(effectiveAt: string): Promise<Partial<Record<ScheduledIncidentType, IncidentRule>>> {
  const entries = await Promise.all(
    SCHEDULED_TYPES.map(async (type) => [type, await loadEffectiveIncidentRule(type, effectiveAt)] as const),
  );
  const rules: Partial<Record<ScheduledIncidentType, IncidentRule>> = {};
  for (const [type, rule] of entries) if (rule) rules[type] = rule;
  return rules;
}

function freshnessBucket(staleAfterSeconds: number | null): string {
  if (staleAfterSeconds === null) return 'unknown';
  if (staleAfterSeconds <= 300) return 'fresh_5m';
  if (staleAfterSeconds <= 1800) return 'stale_30m';
  return 'stale_over_30m';
}

function sanitizedMessage(error: unknown): string {
  // Bounded to a plain message only — never the raw error object, which for a
  // DB/evidence-source failure could carry query text or provider payloads.
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

function boundedErrorSummary(entries: string[]): string | null {
  if (entries.length === 0) return null;
  const bounded = entries.slice(0, MAX_ERROR_ENTRIES).join('; ');
  return bounded.length > MAX_ERROR_SUMMARY_LENGTH ? `${bounded.slice(0, MAX_ERROR_SUMMARY_LENGTH)}…` : bounded;
}

function buildScheduledRequest(
  item: OperationalStatusSummary, incidentType: ScheduledIncidentType, rule: IncidentRule,
  workDate: string, effectiveAt: string, requestCorrelationId: string,
): ScheduledIncidentProducerRequest {
  const assignmentIdentity = buildAssignmentIdentity(item.staffId, null, null);
  const observationFingerprint = computeObservationFingerprint({
    incidentType, ruleId: rule.id, ruleVersion: rule.version, assignmentIdentity,
    reasonCodes: item.reasonCodes, freshnessBucket: freshnessBucket(item.gpsStaleAfterSeconds),
    siteId: item.operationalSiteId, projectId: item.projectId, vehicleId: null, conditionActive: true,
  });
  return {
    producerKind: 'scheduled_detection', incidentType, workDate, severity: rule.severity,
    requestCorrelationId,
    assignment: {
      staffId: item.staffId, vehicleId: null, projectId: item.projectId, operationalSiteId: item.operationalSiteId,
      operationalAssignmentId: null, staffNameSnapshot: item.staffName, projectNameSnapshot: item.projectName,
      operationalSiteNameSnapshot: item.operationalSiteName, vehicleRegistrationSnapshot: null,
    },
    rules: {
      incidentRuleId: rule.id, incidentRuleVersion: rule.version,
      statusRuleId: item.ruleId, statusRuleVersion: item.ruleVersion,
    },
    evaluation: {
      observedAt: effectiveAt, observationFingerprint, primaryStatus: item.status,
      flags: item.flags, reasonCodes: item.reasonCodes,
    },
    evidenceSnapshot: { gpsStaleAfterSeconds: item.gpsStaleAfterSeconds },
  };
}

interface RunTotals {
  opened: number; updated: number; cleared: number; notificationsAccepted: number; notificationsFailed: number;
  errorCount: number; errorMessages: string[];
}

/** See module docblock: positively confirmed presence, with zero evaluation flags of any kind. */
function hasHealthyEvidence(item: OperationalStatusSummary): boolean {
  return HEALTHY_CLEARING_STATUSES.includes(item.status) && item.flags.length === 0;
}

/** Clears any still-open incident of the four scheduled types for this staff/day when this tick's evidence is healthy. A no-op per type when there is no matching active incident — cheap and safe to call unconditionally for every healthy staff row. */
async function clearHealthyConditions(
  item: OperationalStatusSummary, workDate: string, effectiveAt: string, requestCorrelationId: string, totals: RunTotals,
): Promise<void> {
  if (!item.staffId || !hasHealthyEvidence(item)) return;
  const staffId = item.staffId;
  for (const incidentType of SCHEDULED_TYPES) {
    try {
      const result = await evaluateConditionClearing({
        staffId, incidentType, workDate, operationalAssignmentId: null,
        observedAt: effectiveAt, evidenceHealthy: true, requestCorrelationId,
      });
      if (result.outcome === 'cleared') totals.cleared += 1;
    } catch (error) {
      totals.errorCount += 1;
      totals.errorMessages.push(`${staffId}:${incidentType}: ${sanitizedMessage(error)}`);
      log.error('[fleet-operational-monitor] condition-clearing failed', {
        staffId, incidentType, error: sanitizedMessage(error),
      }, MODULE);
    }
  }
}

async function processStaffMember(
  item: OperationalStatusSummary, rules: Partial<Record<ScheduledIncidentType, IncidentRule>>,
  workDate: string, request: IncidentMonitorRequest, monitorRunId: string, totals: RunTotals,
): Promise<void> {
  const scheduledType = resolveScheduledIncidentType(item.status);
  if (!scheduledType) {
    await clearHealthyConditions(item, workDate, request.effectiveAt, monitorRunId, totals);
    return;
  }

  const rule = rules[scheduledType];
  if (!rule || !rule.enabled || !rule.createsIncident) return; // configured off — not an error

  try {
    const producerRequest = buildScheduledRequest(item, scheduledType, rule, workDate, request.effectiveAt, monitorRunId);
    const result = await produceIncident(producerRequest);
    if (result.outcome === 'opened') {
      totals.opened += 1;
      if (result.requiresInitialNotification && result.incidentId) {
        const delivery = await sendIncidentOpenedNotification({
          incidentId: result.incidentId, incidentType: scheduledType,
          severity: rule.severity, producerKind: 'scheduled_detection', rule, projectId: item.projectId,
          staffName: item.staffName, projectName: item.projectName, operationalSiteName: item.operationalSiteName,
          detectedAt: request.effectiveAt, reasonCodes: item.reasonCodes,
        });
        totals.notificationsAccepted += delivery.delivered;
        totals.notificationsFailed += delivery.failed;
      }
    } else if (result.outcome === 'updated') {
      totals.updated += 1;
    }
  } catch (error) {
    totals.errorCount += 1;
    const message = `${item.staffId}: ${sanitizedMessage(error)}`;
    totals.errorMessages.push(message);
    log.error('[fleet-operational-monitor] per-staff evaluation failed', {
      staffId: item.staffId, incidentType: scheduledType, error: sanitizedMessage(error),
    }, MODULE);
  }
}

export async function runOperationalMonitor(request: IncidentMonitorRequest): Promise<IncidentMonitorResult> {
  const run = await startMonitorRun('status_monitor', request.requestedAt, request.effectiveAt);
  const workDate = sastDateString(new Date(request.effectiveAt));

  let roster: OperationalStatusSummary[];
  let rules: Partial<Record<ScheduledIncidentType, IncidentRule>>;
  try {
    roster = await loadMonitoredRoster(workDate, request.effectiveAt);
    rules = await loadScheduledRules(request.effectiveAt);
  } catch (error) {
    const summary = sanitizedMessage(error);
    log.error('[fleet-operational-monitor] systemic roster/status load failure', { runId: run.id, error: summary }, MODULE);
    const finalized = await finalizeMonitorRun(run.id, {
      status: 'failed', rosterEvaluatedCount: 0, incidentsOpenedCount: 0, incidentsUpdatedCount: 0,
      incidentsClearedCount: 0, notificationsAcceptedCount: 0, notificationsFailedCount: 0, summariesSentCount: 0,
      errorCount: 1, errorSummary: summary,
    });
    return {
      monitorRunId: run.id, status: finalized.status, rosterEvaluatedCount: 0, incidentsOpenedCount: 0,
      incidentsUpdatedCount: 0, incidentsClearedCount: 0, notifications: { delivered: 0, suppressed: 0, failed: 0 },
    };
  }

  const totals: RunTotals = {
    opened: 0, updated: 0, cleared: 0, notificationsAccepted: 0, notificationsFailed: 0, errorCount: 0, errorMessages: [],
  };
  for (const item of roster) {
    await processStaffMember(item, rules, workDate, request, run.id, totals);
  }

  const hasFailures = totals.errorCount > 0 || totals.notificationsFailed > 0;
  const status = hasFailures ? 'partial_failure' : 'succeeded';
  const finalized = await finalizeMonitorRun(run.id, {
    status, rosterEvaluatedCount: roster.length, incidentsOpenedCount: totals.opened,
    incidentsUpdatedCount: totals.updated, incidentsClearedCount: totals.cleared,
    notificationsAcceptedCount: totals.notificationsAccepted, notificationsFailedCount: totals.notificationsFailed,
    summariesSentCount: 0, errorCount: totals.errorCount, errorSummary: boundedErrorSummary(totals.errorMessages),
  });

  return {
    monitorRunId: run.id, status: finalized.status, rosterEvaluatedCount: roster.length,
    incidentsOpenedCount: totals.opened, incidentsUpdatedCount: totals.updated, incidentsClearedCount: totals.cleared,
    notifications: { delivered: totals.notificationsAccepted, suppressed: 0, failed: totals.notificationsFailed },
  };
}
