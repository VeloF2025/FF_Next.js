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
 * Scope note (documented per the Task 3 handoff): this monitor only opens
 * and updates the four automatic incident types. It does not attempt
 * condition-clearing for a healthy status — `evaluateConditionClearing`
 * exists in `incidentProducer` but correctly deciding "evidence is healthy"
 * from the roster *summary* alone (no per-staff evidence detail is loaded
 * here) is a distinct, safety-relevant decision that this task's required
 * coverage does not exercise. Clearing is left to a dedicated follow-up
 * rather than shipped unverified. `incidentsClearedCount` is therefore
 * always 0 from this module today.
 *
 * `ScheduledIncidentProducerRequest` (Task 3's authoritative contract) has
 * no dedicated monitor-run field — only `requestCorrelationId`. Rather than
 * widen that contract (out of this task's exact file scope), the run id is
 * threaded through as `requestCorrelationId`, which `incidentProducer`
 * already stores on the `opened` action's `request_correlation_id` column,
 * giving action-to-run traceability without touching Task 3's files.
 *
 * Initial "opened" notifications are sent here (design §8.1 step 7) using a
 * minimal, self-contained project-manager lookup — `recipientService`
 * (PR6 Task 5) does not exist yet. This keeps the monitor independently
 * correct and mergeable; Task 5 should fold this project-manager-only path
 * into the fuller PM + oversight-member resolution it introduces.
 */
import { log } from '@/lib/logger';
import { query } from '@/lib/db-pool';
import { notify } from '@/modules/notifications/services/notificationBus';
import type { NotifyResult } from '@/modules/notifications/types';
import { loadCompleteOperationalRoster } from '../operations/completeRosterLoading';
import type { OperationalStatusSummary } from '../operations/types';
import { sastDateString } from '../parking/sastDate';
import { finalizeMonitorRun, startMonitorRun } from './runRepository';
import { loadEffectiveIncidentRule } from './settingsRepository';
import { produceIncident, resolveScheduledIncidentType } from './incidentProducer';
import { buildAssignmentIdentity, computeObservationFingerprint } from './observationFingerprint';
import type {
  IncidentMonitorRequest, IncidentMonitorResult, IncidentRule, IncidentSeverity,
  ScheduledIncidentProducerRequest, ScheduledIncidentType,
} from './types';

const MODULE = 'FleetOperationalMonitor';
const SCHEDULED_TYPES: readonly ScheduledIncidentType[] = ['late', 'wrong_site', 'evidence_mismatch', 'left_early'];
const MAX_ERROR_SUMMARY_LENGTH = 2000;
const MAX_ERROR_ENTRIES = 20;

interface ProjectIdRow extends Record<string, unknown> { id: string }
interface ProjectManagerRow extends Record<string, unknown> { project_manager: string | null }

/** No system-wide "monitored roster" call exists (statusService is always project-scoped); this discovers the projects to iterate. Mirrors the exact "active" definition already used by `operations/projectScope.ts`. */
async function loadActiveProjectIds(): Promise<string[]> {
  const rows = await query<ProjectIdRow>(
    `/* fleet-operational-monitor:active-projects */ SELECT id FROM projects WHERE LOWER(status) = 'active' ORDER BY id`,
  );
  return rows.map((row) => row.id);
}

/** The whole roster-loading phase for the tick. A failure anywhere in it (project discovery or any one project's roster call) is systemic: the caller must never partially process a roster it could not fully load. */
async function loadMonitoredRoster(workDate: string, effectiveAt: string): Promise<OperationalStatusSummary[]> {
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

function incidentTypeLabel(incidentType: ScheduledIncidentType): string {
  return incidentType.replaceAll('_', ' ');
}

/** Interim, self-contained recipient resolution (see module docblock). Never throws — matches the NotificationBus's own "non-blocking, errors logged not thrown" convention — so a lookup failure surfaces as a counted notification failure rather than aborting this staff member's cycle. */
async function notifyIncidentOpened(input: {
  incidentId: string; incidentType: ScheduledIncidentType; severity: IncidentSeverity;
  projectId: string | null; staffName: string | null; monitorRunId: string;
}): Promise<NotifyResult> {
  let recipientUserId: string | null = null;
  try {
    if (input.projectId) {
      const rows = await query<ProjectManagerRow>(
        `/* fleet-operational-monitor:project-manager */ SELECT project_manager FROM projects WHERE id = $1::uuid LIMIT 1`,
        [input.projectId],
      );
      recipientUserId = rows[0]?.project_manager ?? null;
    }
  } catch (error) {
    log.error('[fleet-operational-monitor] project-manager lookup failed', {
      incidentId: input.incidentId, error: sanitizedMessage(error),
    }, MODULE);
    return { delivered: 0, suppressed: 0, failed: 1 };
  }

  if (!recipientUserId) {
    log.warn('[fleet-operational-monitor] no recipient resolved for opened incident', {
      incidentId: input.incidentId, incidentType: input.incidentType,
    }, MODULE);
    return { delivered: 0, suppressed: 0, failed: 1 };
  }

  try {
    return await notify({
      event_type: 'fleet.operational_incident_opened',
      title: `Fleet incident opened: ${incidentTypeLabel(input.incidentType)}`,
      body: input.staffName ? `${input.staffName} — review required` : 'Review required',
      action_url: `/fleet/incidents?incidentId=${input.incidentId}`,
      source_module: 'fleet-incidents',
      source_id: input.incidentId,
      metadata: { severity: input.severity, incidentType: input.incidentType, monitorRunId: input.monitorRunId },
      recipient_user_ids: [recipientUserId],
      idempotency_key: `fleet-incident-opened:${input.incidentId}`,
    });
  } catch (error) {
    log.error('[fleet-operational-monitor] notify() threw for an opened incident', {
      incidentId: input.incidentId, error: sanitizedMessage(error),
    }, MODULE);
    return { delivered: 0, suppressed: 0, failed: 1 };
  }
}

interface RunTotals {
  opened: number; updated: number; notificationsAccepted: number; notificationsFailed: number;
  errorCount: number; errorMessages: string[];
}

async function processStaffMember(
  item: OperationalStatusSummary, rules: Partial<Record<ScheduledIncidentType, IncidentRule>>,
  workDate: string, request: IncidentMonitorRequest, monitorRunId: string, totals: RunTotals,
): Promise<void> {
  const scheduledType = resolveScheduledIncidentType(item.status);
  if (!scheduledType) return; // healthy/summary-only status — no automatic incident (see module docblock re: clearing scope)

  const rule = rules[scheduledType];
  if (!rule || !rule.enabled || !rule.createsIncident) return; // configured off — not an error

  try {
    const producerRequest = buildScheduledRequest(item, scheduledType, rule, workDate, request.effectiveAt, monitorRunId);
    const result = await produceIncident(producerRequest);
    if (result.outcome === 'opened') {
      totals.opened += 1;
      if (result.requiresInitialNotification && result.incidentId) {
        const delivery = await notifyIncidentOpened({
          incidentId: result.incidentId, incidentType: scheduledType, severity: rule.severity,
          projectId: item.projectId, staffName: item.staffName, monitorRunId,
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

  const totals: RunTotals = { opened: 0, updated: 0, notificationsAccepted: 0, notificationsFailed: 0, errorCount: 0, errorMessages: [] };
  for (const item of roster) {
    await processStaffMember(item, rules, workDate, request, run.id, totals);
  }

  const hasFailures = totals.errorCount > 0 || totals.notificationsFailed > 0;
  const status = hasFailures ? 'partial_failure' : 'succeeded';
  const finalized = await finalizeMonitorRun(run.id, {
    status, rosterEvaluatedCount: roster.length, incidentsOpenedCount: totals.opened,
    incidentsUpdatedCount: totals.updated, incidentsClearedCount: 0,
    notificationsAcceptedCount: totals.notificationsAccepted, notificationsFailedCount: totals.notificationsFailed,
    summariesSentCount: 0, errorCount: totals.errorCount, errorSummary: boundedErrorSummary(totals.errorMessages),
  });

  return {
    monitorRunId: run.id, status: finalized.status, rosterEvaluatedCount: roster.length,
    incidentsOpenedCount: totals.opened, incidentsUpdatedCount: totals.updated, incidentsClearedCount: 0,
    notifications: { delivered: totals.notificationsAccepted, suppressed: 0, failed: totals.notificationsFailed },
  };
}
