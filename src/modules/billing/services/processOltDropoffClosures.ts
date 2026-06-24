// src/modules/billing/services/processOltDropoffClosures.ts
/**
 * Auto-clear OLT Investigate records when a previously note2/note4-flagged DR
 * drops off FiberTime's weekly notes.
 *
 * Called best-effort from the weekly billing bundle import (and as a read-only
 * dry-run on preview). For one project + week it:
 *   1. finds DRs flagged note2/note4 in PRIOR weeks (priorFlagged),
 *   2. subtracts this week's note2/note4 DRs (currentFlagged) → droppedOff,
 *   3. intersects droppedOff with currently-OPEN olt_mismatch_records,
 *   4. closes the linked NOC ticket (cascade removes the record) or resolves
 *      the unticketed record directly, and writes the DR-history audit.
 *
 * Trust model: FT dropping the note is treated as authoritative (decided
 * 2026-06-24). Self-healing: a later re-deduction is re-detected by the OLT
 * report import and flagged not_returned by processExpectedRecoveries.
 */

export interface OpenMismatchRecord {
  id: string;
  dropNumber: string;
  maintenanceTicketId: string | null;
  ticketUid: string | null;
  ticketStatus: string | null;
}

/**
 * Pure drop-off filter: open records whose DR was flagged note2/note4 before
 * (`priorFlaggedDrs`) and is NOT flagged note2/note4 this week
 * (`currentFlaggedDrs`). The prior gate ensures we never touch records that are
 * open purely from auto-detection (never FT-flagged).
 */
export function computeDropOffClosures(
  priorFlaggedDrs: Set<string>,
  currentFlaggedDrs: Set<string>,
  openRecords: OpenMismatchRecord[],
): OpenMismatchRecord[] {
  return openRecords.filter(
    (r) => priorFlaggedDrs.has(r.dropNumber) && !currentFlaggedDrs.has(r.dropNumber),
  );
}
