/**
 * Driver submission transaction (design §§7, 10, 16). Mirrors
 * `./requestInputService.ts`'s shape: lock the incident row inside a
 * transaction, revalidate eligibility against that locked state (so a
 * response racing with a manager closing the incident is decided by
 * whichever commits first — design §16), append the submission/action,
 * commit, then notify current PR6-scoped recipients strictly *after*
 * commit (CLAUDE.md hard rule; never from inside the transaction).
 *
 * `computeResponseEligibility` is imported from `./driverIncidentService.ts`
 * rather than redefined here — see that module's docstring for why reads
 * and this write path must share one eligibility rule.
 *
 * Idempotent replay: `insertDriverSubmission` is idempotent on
 * `(incident_id, staff_id, idempotency_key)`. A genuinely new submission
 * (`created: true`) appends one `driver_submitted` action; a retried
 * duplicate (`created: false`) does not — the same submission row is
 * simply returned again. Manager notification is still attempted on
 * replay (mirroring `requestInputService.ts`'s own re-request behavior)
 * because it is `submission.id`-keyed and therefore already idempotent one
 * layer down, in `notify()` itself.
 */
import { transaction, type TxnClient } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { isValidUUID } from '../../services/mileageUtils';
import { IncidentNotFoundError } from '../incidentRepository';
import { getIncidentCore } from '../reviewQueries';
import { resolveIncidentRecipients } from '../recipientService';
import { computeResponseEligibility, type ResponseIneligibleReason } from './driverIncidentService';
import { findCurrentInputRequest, lockIncidentForDriver, neutralIncidentLabel } from './driverInputRepository';
import { insertDriverSubmission, type DriverSubmissionRecord } from './driverInputWriteRepository';
import { notifyDriverResponseReceived } from './driverNotifications';
import { deriveDriverInputState } from './inputState';
import { getEffectiveDriverInputSettings } from './settingsRepository';
import type { DriverConcernCategory, DriverSubmissionKind, DriverSubmissionResult, SubmitDriverResponseCommand } from './types';

const MODULE = 'FleetDriverSubmission';
const MAX_EXPLANATION_LENGTH = 4000;
const SUBMISSION_KINDS: readonly DriverSubmissionKind[] = ['response', 'follow_up'];
const CONCERN_CATEGORIES: readonly DriverConcernCategory[] = ['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'];

export class DriverSubmissionValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'DriverSubmissionValidationError'; }
}
/** A submission was well-formed and the driver owns the incident, but the response window/terminal policy does not currently accept one. `reason` lets the API/UI show the specific neutral copy design §15/§16 requires (not just a generic conflict). */
export class DriverSubmissionNotEligibleError extends Error {
  readonly reason: ResponseIneligibleReason;
  constructor(reason: ResponseIneligibleReason) {
    super(`Driver responses are not currently accepted on this incident (${reason})`);
    this.name = 'DriverSubmissionNotEligibleError';
    this.reason = reason;
  }
}

interface ParsedCommand { incidentId: string; submissionKind: DriverSubmissionKind; explanation: string; concernCategory: DriverConcernCategory | null; idempotencyKey: string }

function validateCommand(command: SubmitDriverResponseCommand): ParsedCommand {
  if (!isValidUUID(command.incidentId)) throw new DriverSubmissionValidationError('incidentId must be a valid UUID');
  if (!SUBMISSION_KINDS.includes(command.submissionKind)) throw new DriverSubmissionValidationError('submissionKind must be "response" or "follow_up"');
  const explanation = typeof command.explanation === 'string' ? command.explanation.trim() : '';
  if (explanation.length === 0) throw new DriverSubmissionValidationError('explanation is required');
  if (explanation.length > MAX_EXPLANATION_LENGTH) throw new DriverSubmissionValidationError(`explanation cannot exceed ${MAX_EXPLANATION_LENGTH} characters`);
  if (typeof command.idempotencyKey !== 'string' || command.idempotencyKey.trim().length === 0) {
    throw new DriverSubmissionValidationError('idempotencyKey is required');
  }
  const concernCategory = command.concernCategory ?? null;
  if (concernCategory !== null && !CONCERN_CATEGORIES.includes(concernCategory)) {
    throw new DriverSubmissionValidationError('concernCategory is not a recognized category');
  }
  return { incidentId: command.incidentId, submissionKind: command.submissionKind, explanation, concernCategory, idempotencyKey: command.idempotencyKey };
}

interface TransactionOutcome {
  submission: DriverSubmissionRecord; created: boolean;
  currentRequest: { requestedAt: string; respondBy: string } | null; terminalAt: string | null;
}

async function runSubmissionTransaction(
  parsed: ParsedCommand, sessionStaffId: string,
  settings: { postClosureResponseEnabled: boolean; postClosureResponseWindowDays: number }, now: string,
): Promise<TransactionOutcome> {
  return transaction(async (txn: TxnClient) => {
    const locked = await lockIncidentForDriver(sessionStaffId, parsed.incidentId, txn);
    if (!locked) throw new IncidentNotFoundError(`No incident found for id ${parsed.incidentId}`);

    const currentRequest = await findCurrentInputRequest(parsed.incidentId, txn);
    const eligibility = computeResponseEligibility({
      now, currentRequest: currentRequest ? { respondBy: currentRequest.respondBy } : null,
      incidentTerminalAt: locked.terminalAt, postClosureResponseEnabled: settings.postClosureResponseEnabled,
      postClosureResponseWindowDays: settings.postClosureResponseWindowDays,
    });
    if (!eligibility.eligible) throw new DriverSubmissionNotEligibleError(eligibility.reason);

    const insertResult = await insertDriverSubmission({
      incidentId: parsed.incidentId, inputRequestId: currentRequest?.id ?? null, staffId: sessionStaffId,
      submissionKind: parsed.submissionKind, explanation: parsed.explanation, concernCategory: parsed.concernCategory,
      idempotencyKey: parsed.idempotencyKey, clientMetadata: {},
    }, txn);

    if (insertResult.created) {
      // A submission never sets lifecycle/outcome/acknowledgement/visibility
      // of the incident itself — before/after lifecycle_status are recorded
      // unchanged, and there is no escalation-level change at all.
      await txn.query(
        `INSERT INTO fleet_operational_incident_actions
          (incident_id, action_type, actor_staff_id, is_system_actor, note, visibility,
           before_lifecycle_status, after_lifecycle_status, metadata)
         VALUES ($1::uuid, 'driver_response_received', $2::uuid, false, NULL, 'driver_submitted', $3, $3, '{}'::jsonb)`,
        [parsed.incidentId, sessionStaffId, locked.lifecycleStatus],
      );
    }

    return {
      submission: insertResult.record, created: insertResult.created,
      currentRequest: currentRequest ? { requestedAt: currentRequest.requestedAt, respondBy: currentRequest.respondBy } : null,
      terminalAt: locked.terminalAt,
    };
  });
}

/** Never throws — a notification failure must not turn an already-committed submission into a 500 for its caller. */
async function notifyManagers(submission: DriverSubmissionRecord, incidentId: string): Promise<void> {
  try {
    const core = await getIncidentCore(incidentId);
    if (!core) {
      log.error('[fleet-driver-submission] incident vanished before manager notification could be built', { submissionId: submission.id, incidentId }, MODULE);
      return;
    }
    const recipients = await resolveIncidentRecipients(core.projectId);
    await notifyDriverResponseReceived(
      { submissionId: submission.id, submissionKind: submission.submissionKind },
      {
        incidentId, incidentReference: core.incidentReference, neutralLabel: neutralIncidentLabel(core.incidentType),
        projectLabel: core.projectName, siteLabel: core.operationalSiteName,
      },
      recipients.userIds,
    );
  } catch (error) {
    log.error('[fleet-driver-submission] failed to notify managers after a committed driver response', {
      submissionId: submission.id, incidentId, error: error instanceof Error ? error.message : String(error),
    }, MODULE);
  }
}

/**
 * Accepts a driver's explanation/follow-up/concern report. `sessionStaffId`
 * is a required, separate argument derived from the `/my` session — the
 * command carries no staff identity field to override it.
 */
export async function submitDriverResponse(command: SubmitDriverResponseCommand, sessionStaffId: string): Promise<DriverSubmissionResult> {
  const parsed = validateCommand(command);
  const now = new Date().toISOString();
  const settings = await getEffectiveDriverInputSettings(now);
  if (parsed.concernCategory !== null && !settings.enabledConcernCategories.includes(parsed.concernCategory)) {
    throw new DriverSubmissionValidationError('concernCategory is not currently enabled');
  }

  const outcome = await runSubmissionTransaction(parsed, sessionStaffId, settings, now);

  const driverInputState = deriveDriverInputState({
    now, currentRequest: outcome.currentRequest, respondedAt: outcome.submission.createdAt,
    incidentTerminalAt: outcome.terminalAt, postClosureResponseEnabled: settings.postClosureResponseEnabled,
    postClosureResponseWindowDays: settings.postClosureResponseWindowDays,
  });

  await notifyManagers(outcome.submission, parsed.incidentId);

  return { submissionId: outcome.submission.id, incidentId: parsed.incidentId, driverInputState, created: outcome.created };
}
