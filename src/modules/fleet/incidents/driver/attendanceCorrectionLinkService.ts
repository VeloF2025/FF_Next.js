/**
 * Canonical Attendance correction linking (PR7 Task 6, design §8/§11.3).
 *
 * Fleet never creates or mutates an `attendance_adjustments` row — that
 * remains Attendance's own `submitMissingClockOutCorrection`
 * (`../../attendance/workflow/requiredActionCorrection.ts`), reached
 * through Attendance's own `/api/my/attendance-corrections` route exactly
 * as it is for a correction opened independently. This module only:
 *
 *  1. answers whether the incident's `work_date` currently has an open
 *     Attendance "missing clock-out" exception the driver may still
 *     correct (`getAttendanceCorrectionEligibility`), reusing Attendance's
 *     own exported `CORRECTION_ELIGIBILITY_SQL` predicate rather than a
 *     duplicated copy of it, so the two can never drift; and
 *  2. records a durable, append-only reference to an Attendance correction
 *     the driver already submitted (`linkAttendanceCorrection`), after
 *     verifying in SQL — scoped to `sessionStaffId`, never a caller-named
 *     id — that the correction belongs to this driver and its entry's
 *     `work_date` matches the incident's.
 *
 * `fleet_incident_attendance_correction_links` (migration 503) grants the
 * app SELECT/INSERT only — no UPDATE at all, unlike the sibling requests
 * table's six-column carve-out — because this table stores no status of
 * its own; `correctionState` is read live from `attendance_adjustments`
 * on every call, matching `../driverIncidentService.ts`'s
 * `loadOwnCorrectionLinks` read path so the two can never disagree.
 *
 * `sessionStaffId` is always a required, separate argument derived from
 * the `/my` session — no command here carries a staff/driver identity
 * field that could override it (design §10).
 */
import { queryOne } from '@/lib/db-pool';
import { CORRECTION_ELIGIBILITY_SQL } from '@/modules/attendance/workflow/correctionEligibility';
import { isValidUUID } from '../../services/mileageUtils';
import { IncidentNotFoundError } from '../incidentRepository';
import { computeResponseEligibility } from './driverIncidentService';
import { findCurrentInputRequest, poolExecutor } from './driverInputRepository';
import { getEffectiveDriverInputSettings } from './settingsRepository';
import type { AttendanceCorrectionEligibility, AttendanceCorrectionLinkResult, AttendanceCorrectionState } from './types';

export { IncidentNotFoundError };

export class AttendanceCorrectionLinkValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'AttendanceCorrectionLinkValidationError'; }
}

/**
 * Well-formed and the incident is genuinely this driver's own, but the
 * named `attendanceCorrectionId` does not belong to them or does not match
 * the incident's work date — the same response as if it did not exist at
 * all (design §10 IDOR safety: never confirm another staff member's
 * correction exists).
 */
export class AttendanceCorrectionNotFoundError extends Error {
  constructor(public readonly attendanceCorrectionId: string) {
    super('Attendance correction not found for this driver and incident');
    this.name = 'AttendanceCorrectionNotFoundError';
  }
}

interface OwnedIncidentRow extends Record<string, unknown> { work_date: string | null; resolved_at: string | Date | null }
interface OwnedIncident { workDate: string | null; terminalAt: string | null }

function isoOrNull(value: string | Date | null): string | null {
  return value === null ? null : value instanceof Date ? value.toISOString() : value;
}

/** Scoped by both incident id and staff id in one predicate, mirroring `../driverInputRepository.ts`'s `lockIncidentForDriver` — a non-owning staff id simply matches no row, indistinguishable from a missing incident id. */
async function loadOwnedIncidentForCorrection(staffId: string, incidentId: string): Promise<OwnedIncident | null> {
  const row = await queryOne<OwnedIncidentRow>(
    `SELECT work_date::text AS work_date, resolved_at FROM fleet_operational_incidents WHERE id = $1::uuid AND staff_id = $2::uuid`,
    [incidentId, staffId],
  );
  return row ? { workDate: row.work_date, terminalAt: isoOrNull(row.resolved_at) } : null;
}

interface RequiredExceptionRow extends Record<string, unknown> { exception_id: string; entry_id: string }

/** The one open Attendance "missing clock-out" exception for `staffId` on `workDate`, using Attendance's own shared eligibility predicate — never a re-derived copy of it. */
async function findRequiredExceptionForWorkDate(staffId: string, workDate: string | null): Promise<RequiredExceptionRow | null> {
  if (!workDate) return null;
  return queryOne<RequiredExceptionRow>(
    `SELECT de.id::text AS exception_id, de.entry_id::text AS entry_id
    ${CORRECTION_ELIGIBILITY_SQL}
      AND de.work_date = $2::date
    LIMIT 1`,
    [staffId, workDate],
  );
}

/** Mirrors `../../attendance/workflow/requiredActionCorrection.ts`'s own `period_locked` computation. */
async function isPeriodLocked(workDate: string): Promise<boolean> {
  const row = await queryOne<{ locked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM attendance_weekly_locks
       WHERE week_start_date = date_trunc('week', $1::date)::date AND unlocked_at IS NULL
     ) AS locked`,
    [workDate],
  );
  return row?.locked ?? false;
}

/**
 * Ordered so the cheapest, most fundamental question is answered first:
 * "is there anything to correct at all" before spending a query on payroll
 * locks or the Fleet driver-input response window (this task's ruling —
 * the design lists the three reasons but not their precedence).
 */
export async function getAttendanceCorrectionEligibility(
  incidentId: string, sessionStaffId: string,
): Promise<AttendanceCorrectionEligibility> {
  if (!isValidUUID(incidentId)) throw new AttendanceCorrectionLinkValidationError('incidentId must be a valid UUID');

  const incident = await loadOwnedIncidentForCorrection(sessionStaffId, incidentId);
  if (!incident) throw new IncidentNotFoundError(`No incident found for id ${incidentId}`);

  const exception = await findRequiredExceptionForWorkDate(sessionStaffId, incident.workDate);
  if (!exception) return { eligible: false, reason: 'no_required_exception' };

  // Evaluated here so the query order is unchanged, but REPORTED below the response-window
  // check. `period_locked` reads as actionable — "contact your supervisor to request an
  // unlock" — while a payroll unlock cannot reopen a closed Fleet response window. Reporting
  // the lock first sent a driver whose window had also closed to their supervisor for an
  // unlock that would leave them blocked anyway. Report the unremediable reason first; the
  // design names the three reasons without an order, so this precedence is a ruling.
  const periodLocked = await isPeriodLocked(incident.workDate as string);

  const now = new Date().toISOString();
  const settings = await getEffectiveDriverInputSettings(now);
  const currentRequest = await findCurrentInputRequest(incidentId, poolExecutor);
  const responseEligibility = computeResponseEligibility({
    now, currentRequest: currentRequest ? { respondBy: currentRequest.respondBy } : null,
    incidentTerminalAt: incident.terminalAt,
    postClosureResponseEnabled: settings.postClosureResponseEnabled,
    postClosureResponseWindowDays: settings.postClosureResponseWindowDays,
  });
  if (!responseEligibility.eligible) return { eligible: false, reason: 'outside_response_window' };
  if (periodLocked) return { eligible: false, reason: 'period_locked' };

  return { eligible: true, exceptionId: exception.exception_id, entryId: exception.entry_id };
}

export interface LinkAttendanceCorrectionCommand {
  incidentId: string;
  attendanceCorrectionId: string;
  /** Optional: the driver submission this link was started from, when applicable. Verified to belong to the same incident/driver, never trusted blindly. */
  driverSubmissionId?: string | null;
}
interface ParsedLinkCommand { incidentId: string; attendanceCorrectionId: string; driverSubmissionId: string | null }

function validateLinkCommand(command: LinkAttendanceCorrectionCommand): ParsedLinkCommand {
  if (!isValidUUID(command.incidentId)) throw new AttendanceCorrectionLinkValidationError('incidentId must be a valid UUID');
  if (!isValidUUID(command.attendanceCorrectionId)) throw new AttendanceCorrectionLinkValidationError('attendanceCorrectionId must be a valid UUID');
  const driverSubmissionId = command.driverSubmissionId ?? null;
  if (driverSubmissionId !== null && !isValidUUID(driverSubmissionId)) {
    throw new AttendanceCorrectionLinkValidationError('driverSubmissionId must be a valid UUID');
  }
  return { incidentId: command.incidentId, attendanceCorrectionId: command.attendanceCorrectionId, driverSubmissionId };
}

/** Defense in depth: a named `driverSubmissionId` must belong to the same incident and staff member, even though nothing here currently reads it back. */
async function ownsSubmission(staffId: string, incidentId: string, driverSubmissionId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM fleet_incident_driver_submissions WHERE id = $1::uuid AND incident_id = $2::uuid AND staff_id = $3::uuid`,
    [driverSubmissionId, incidentId, staffId],
  );
  return row !== null;
}

interface CorrectionOwnershipRow extends Record<string, unknown> { id: string; status: AttendanceCorrectionState }

/**
 * The one Attendance correction `attendanceCorrectionId`, only if it was
 * requested by `staffId` AND its entry belongs to that same staff member
 * AND that entry's `work_date` equals the incident's — three independent
 * checks in one query so a mismatch on any of them (someone else's
 * correction, or a correction for a different day) is indistinguishable
 * from a correction that does not exist at all.
 */
async function loadOwnedCorrectionForWorkDate(
  staffId: string, attendanceCorrectionId: string, incidentWorkDate: string | null,
): Promise<CorrectionOwnershipRow | null> {
  if (!incidentWorkDate) return null;
  return queryOne<CorrectionOwnershipRow>(
    `SELECT a.id, a.status
     FROM attendance_adjustments a
     JOIN attendance_entries e ON e.id = a.entry_id
     WHERE a.id = $1::uuid AND a.requested_by = $2::uuid AND e.staff_id = $2::uuid AND e.work_date = $3::date`,
    [attendanceCorrectionId, staffId, incidentWorkDate],
  );
}

interface LinkRow extends Record<string, unknown> { id: string }

/** Idempotent on the migration's `UNIQUE (incident_id, attendance_correction_id)`: a duplicate attempt returns the pre-existing row rather than erroring, matching design §16's "repeated calls return the existing record" rule. */
async function insertOrGetLink(args: {
  incidentId: string; attendanceCorrectionId: string; staffId: string; driverSubmissionId: string | null;
}): Promise<LinkRow> {
  const inserted = await queryOne<LinkRow>(
    `INSERT INTO fleet_incident_attendance_correction_links
       (incident_id, driver_submission_id, attendance_correction_id, staff_id, linked_by)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $4::uuid)
     ON CONFLICT (incident_id, attendance_correction_id) DO NOTHING
     RETURNING id`,
    [args.incidentId, args.driverSubmissionId, args.attendanceCorrectionId, args.staffId],
  );
  if (inserted) return inserted;

  const existing = await queryOne<LinkRow>(
    `SELECT id FROM fleet_incident_attendance_correction_links WHERE incident_id = $1::uuid AND attendance_correction_id = $2::uuid`,
    [args.incidentId, args.attendanceCorrectionId],
  );
  if (!existing) throw new Error('Attendance correction link insert returned no row and no existing row was found');
  return existing;
}

/**
 * Records a durable reference to an Attendance correction the driver
 * already submitted through Attendance's own workflow. Never writes to
 * `attendance_adjustments` — only reads its live `status` back, which
 * matches `AttendanceCorrectionState` exactly (verified against
 * `scripts/migrations/sql/320_attendance_corrections_and_locks.sql`).
 */
export async function linkAttendanceCorrection(
  command: LinkAttendanceCorrectionCommand, sessionStaffId: string,
): Promise<AttendanceCorrectionLinkResult> {
  const parsed = validateLinkCommand(command);

  const incident = await loadOwnedIncidentForCorrection(sessionStaffId, parsed.incidentId);
  if (!incident) throw new IncidentNotFoundError(`No incident found for id ${parsed.incidentId}`);

  if (parsed.driverSubmissionId && !(await ownsSubmission(sessionStaffId, parsed.incidentId, parsed.driverSubmissionId))) {
    throw new AttendanceCorrectionLinkValidationError('driverSubmissionId does not belong to this incident/driver');
  }

  const correction = await loadOwnedCorrectionForWorkDate(sessionStaffId, parsed.attendanceCorrectionId, incident.workDate);
  if (!correction) throw new AttendanceCorrectionNotFoundError(parsed.attendanceCorrectionId);

  const link = await insertOrGetLink({
    incidentId: parsed.incidentId, attendanceCorrectionId: parsed.attendanceCorrectionId,
    staffId: sessionStaffId, driverSubmissionId: parsed.driverSubmissionId,
  });

  return {
    linkId: link.id, incidentId: parsed.incidentId, attendanceCorrectionId: parsed.attendanceCorrectionId,
    correctionState: correction.status,
  };
}
