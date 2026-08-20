/**
 * Attendance-correction eligibility checks for a driver's own incident (PR7
 * Task 6, design §8/§11.3). Split out of `attendanceCorrectionLinkService.ts`
 * (PR7 review I6: that file exceeded the project's 300-line cap for new
 * files) — this module owns the read-only "can this driver still correct
 * Attendance for this incident's work date" question; the sibling module
 * owns recording a link once Attendance's own workflow accepts the
 * correction. `attendanceCorrectionLinkService.ts` re-exports
 * `getAttendanceCorrectionEligibility` and `loadOwnedIncidentForCorrection`
 * from here, so nothing outside `driver/` needs to know the split exists.
 *
 * Fleet never creates or mutates an `attendance_adjustments` row here
 * either — this only reads, using Attendance's own exported
 * `CORRECTION_ELIGIBILITY_SQL` predicate rather than a duplicated copy of
 * it, so the two can never drift.
 */
import { queryOne } from '@/lib/db-pool';
import { CORRECTION_ELIGIBILITY_SQL } from '@/modules/attendance/workflow/correctionEligibility';
import { isValidUUID } from '../../services/mileageUtils';
import { IncidentNotFoundError } from '../incidentRepository';
import { computeResponseEligibility } from './driverIncidentService';
import { findCurrentInputRequest, poolExecutor } from './driverInputRepository';
import { getEffectiveDriverInputSettings } from './settingsRepository';
import type { AttendanceCorrectionEligibility } from './types';

export { IncidentNotFoundError };

export class AttendanceCorrectionLinkValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'AttendanceCorrectionLinkValidationError'; }
}

export interface OwnedIncident { workDate: string | null; terminalAt: string | null }
interface OwnedIncidentRow extends Record<string, unknown> { work_date: string | null; resolved_at: string | Date | null }

function isoOrNull(value: string | Date | null): string | null {
  return value === null ? null : value instanceof Date ? value.toISOString() : value;
}

/** Scoped by both incident id and staff id in one predicate, mirroring `../driverInputRepository.ts`'s `lockIncidentForDriver` — a non-owning staff id simply matches no row, indistinguishable from a missing incident id. Exported for `attendanceCorrectionLinkService.ts#linkAttendanceCorrection`, which needs the same ownership check before recording a link. */
export async function loadOwnedIncidentForCorrection(staffId: string, incidentId: string): Promise<OwnedIncident | null> {
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

interface SubmittedAdjustmentRow extends Record<string, unknown> { adjustment_id: string }

/**
 * The Attendance correction already submitted for `staffId` on `workDate`,
 * if any — independent of `CORRECTION_ELIGIBILITY_SQL`, which requires
 * `de.adjustment_id IS NULL` and therefore excludes exactly the row a
 * driver has already submitted a correction for. Mirrors that shared
 * predicate's `ds.result_version = de.result_version` guard (the same
 * disambiguator across recomputations covering multiple exceptions on one
 * work date), so a stale exception row from a superseded computation never
 * surfaces a correction here.
 */
async function findSubmittedAdjustmentForWorkDate(staffId: string, workDate: string): Promise<string | null> {
  const row = await queryOne<SubmittedAdjustmentRow>(
    `SELECT de.adjustment_id::text AS adjustment_id
     FROM attendance_day_exceptions de
     JOIN attendance_daily_summaries ds
       ON ds.staff_id = de.staff_id AND ds.work_date = de.work_date
     WHERE de.staff_id = $1::uuid
       AND de.kind = 'missing_clock_out'
       AND de.work_date = $2::date
       AND de.adjustment_id IS NOT NULL
       AND ds.result_version = de.result_version
     LIMIT 1`,
    [staffId, workDate],
  );
  return row?.adjustment_id ?? null;
}

/** Whether `attendanceCorrectionId` already has a `fleet_incident_attendance_correction_links` row for `incidentId` specifically — the link table's uniqueness is per `(incident_id, attendance_correction_id)`, so a correction already linked to a *different* incident must still be reported as retryable here. */
async function isLinkedToIncident(incidentId: string, attendanceCorrectionId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM fleet_incident_attendance_correction_links
     WHERE incident_id = $1::uuid AND attendance_correction_id = $2::uuid`,
    [incidentId, attendanceCorrectionId],
  );
  return row !== null;
}

/**
 * Server-derived replacement for what used to be a client-side
 * `localStorage` marker: the one correction (if any) the driver already
 * submitted for the incident's work date that is not yet linked to THIS
 * incident. `staffId`-scoped throughout, so this can never surface another
 * driver's correction.
 */
async function findRetryableCorrectionId(staffId: string, incidentId: string, workDate: string | null): Promise<string | null> {
  if (!workDate) return null;
  const adjustmentId = await findSubmittedAdjustmentForWorkDate(staffId, workDate);
  if (!adjustmentId) return null;
  if (await isLinkedToIncident(incidentId, adjustmentId)) return null;
  return adjustmentId;
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
  if (!exception) {
    const retryCorrectionId = await findRetryableCorrectionId(sessionStaffId, incidentId, incident.workDate);
    return { eligible: false, reason: 'no_required_exception', retryCorrectionId };
  }

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
