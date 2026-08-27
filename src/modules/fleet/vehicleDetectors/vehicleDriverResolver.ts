/**
 * Which driver, if any, was the vehicle assigned to when the event happened?
 *
 * A telematics detector observes a VEHICLE. Until this file existed, every
 * incident it opened carried `staff_id = NULL`, so the review queue said
 * "Unassigned" for something a person was demonstrably driving and no manager
 * could ask that person what happened. `vehicle_assignments` is the driver ↔
 * vehicle source of truth in this database (22 active rows in production), so
 * the honest answer is the assignment that covered the vehicle at the event
 * instant — not "whoever is assigned today", which would attribute a
 * three-week-old accident to the current driver.
 *
 * ## Why a calendar DATE and not a timestamp
 *
 * `assignment_start`/`assignment_end` are DATE columns, not timestamptz. An
 * assignment is a day-granular fact, so the comparison is a day-granular one:
 * the event instant is folded to its **SAST calendar date** (the fleet's own
 * zone — `VEHICLE_RULE_TIMEZONE`) and compared as `YYYY-MM-DD` strings, which
 * order lexicographically exactly as dates do. Comparing a DATE against a
 * timestamptz in SQL would have let the session timezone decide the answer,
 * and a 22:30 UTC event is already tomorrow in Johannesburg.
 *
 * Both ends are INCLUSIVE: an assignment that starts today covers today, and
 * one that ended today still covers today. That matches how a handover is
 * captured — the leaving driver's row is ended on the SAME date the incoming
 * driver's row starts (e.g. `2026-03-03 → 2026-04-30` closed, `2026-04-30`
 * open). On that one shared date both rows cover the event and the newest start
 * wins, so a handover day is attributed to the INCOMING driver. That is the
 * price of a day-granular table: it cannot say who held the keys at 09:00. Say
 * so rather than inventing a tie-break the data does not support.
 *
 * ## `is_active` is NOT part of the rule — the dates are
 *
 * Every close path sets the flag and the end date in one statement, so all 63
 * production rows are one of exactly two shapes: `{is_active, end IS NULL}` (22
 * rows) or `{NOT is_active, end IS NOT NULL}` (41 rows). Filtering on the flag
 * would therefore make the date bounds unreachable and throw away ALL history:
 * an event that predates the current driver's start would resolve to nobody
 * even though a closed row names exactly who was driving. Closed rows are the
 * history this resolver exists to read. A hypothetical `{NOT is_active, end IS
 * NULL}` row — none exists — would attribute indefinitely under this rule;
 * fix the row, not the resolver, if one ever appears.
 *
 * ## What this changes, deliberately
 *
 * Attribution is not cosmetic. `staff_id` is what `/my` reads
 * (`driver/driverInputRepository.ts#findDriverIncidents`) and what
 * `driver/requestInputService.ts` refuses to run without. So a resolved driver
 * makes the incident visible on that driver's own portal and makes
 * manager-initiated driver input possible — which is the point. Nothing here
 * notifies the driver: `recipientService.resolveIncidentRecipients` resolves
 * the project manager plus oversight members only, and never the incident's
 * own staff member.
 *
 * Manager-side scoping is unaffected: `reviewQueries.buildWhere` and
 * `reviewScope.isProjectOwnedByScope` both key on `project_id` alone, so a
 * driver's identity neither widens nor narrows who works the queue.
 */

import { log } from '@/lib/logger';
import { zonedDateParts } from './afterHours';
import { loadVehicleDriverAssignments } from './detectorQueries';
import { VEHICLE_RULE_TIMEZONE, type VehicleDriverAssignment } from './types';

const MODULE = 'FleetVehicleDetectors';

/** The driver an incident is attributed to, plus the name snapshotted onto it. */
export interface VehicleDriver {
  staffId: string;
  staffName: string | null;
}

export type VehicleAssignmentLoader = (vehicleId: string) => Promise<VehicleDriverAssignment[]>;

/**
 * The assignment covering `eventDate`, or null.
 *
 * Pure and exported so the boundary is testable without a database. Closed
 * rows count: they are how the table records who was driving in the past, and
 * the flag is not consulted at all (see this module's header). When more than
 * one assignment covers the date — a handover day always produces two — the
 * NEWEST `assignmentStart` wins: that is the most recent statement anybody made
 * about who drives this vehicle. Ties keep the first row the loader returned,
 * which orders deterministically.
 */
export function selectDriverAssignmentAt(
  assignments: readonly VehicleDriverAssignment[], eventDate: string,
): VehicleDriverAssignment | null {
  let best: VehicleDriverAssignment | null = null;
  for (const assignment of assignments) {
    if (assignment.assignmentStart > eventDate) continue;
    if (assignment.assignmentEnd !== null && assignment.assignmentEnd < eventDate) continue;
    if (best === null || assignment.assignmentStart > best.assignmentStart) best = assignment;
  }
  return best;
}

/**
 * The vehicle's driver at `occurredAt`, or null when nothing covers it.
 *
 * A failing lookup returns null and logs rather than throwing, for the same
 * reason `vehicleProjectResolver` does: attribution is an enrichment, and
 * losing it must never stop the incident that carries it from being opened.
 * Null is not a new state — it is exactly what every vehicle incident carried
 * before this file existed.
 */
export async function resolveVehicleDriver(
  vehicleId: string, occurredAt: string, load: VehicleAssignmentLoader = loadVehicleDriverAssignments,
): Promise<VehicleDriver | null> {
  try {
    const eventDate = zonedDateParts(occurredAt, VEHICLE_RULE_TIMEZONE).date;
    const assignment = selectDriverAssignmentAt(await load(vehicleId), eventDate);
    return assignment ? { staffId: assignment.staffId, staffName: assignment.staffName } : null;
  } catch (error) {
    log.warn(
      '[fleet-detectors] driver attribution failed; opening the incident unattributed',
      { vehicleId, error: error instanceof Error ? error.message : String(error) },
      MODULE,
    );
    return null;
  }
}
