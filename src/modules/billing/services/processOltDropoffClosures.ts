// src/modules/billing/services/processOltDropoffClosures.ts
/**
 * Auto-clear OLT Investigate records when FibreTime's weekly notes show that a
 * previously flagged DR no longer needs investigation.
 *
 * Called best-effort from the weekly billing bundle import (and as a read-only
 * dry-run on preview). For one project + week it:
 *   1. keeps the existing note2/note4 rule: if a DR was note2/note4 before and
 *      is not note2/note4 this week, close it;
 *   2. adds the conservative all-notes rule: if a DR was note1/note3/note5
 *      before and is absent from ALL current notes, close it;
 *   3. intersects candidates with currently-OPEN olt_mismatch_records;
 *   4. closes the linked NOC ticket (cascade resolves the record) or resolves
 *      the unticketed record directly, and writes DR-history audit rows.
 *
 * Trust model: FT dropping the relevant note/sheet entry is treated as
 * authoritative. Self-healing: a later re-deduction is re-detected by the OLT
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
 * Pure drop-off filter.
 *
 * Rules:
 * - note2/note4 preserve the original behaviour: prior note2/4 and no current
 *   note2/4 means close.
 * - other notes only close when the DR is absent from ALL current notes. This
 *   avoids closing a DR that merely moved from note5 to note2, etc.
 *
 * The prior gates ensure we never touch records open purely from auto-detection
 * and never FT-flagged.
 */
export function computeDropOffClosures(
  priorNote2or4Drs: Set<string>,
  currentNote2or4Drs: Set<string>,
  openRecords: OpenMismatchRecord[],
  priorOtherNoteDrs: Set<string> = new Set(),
  currentAnyNoteDrs: Set<string> = currentNote2or4Drs,
): OpenMismatchRecord[] {
  return openRecords.filter((r) => {
    const note2or4Dropoff = priorNote2or4Drs.has(r.dropNumber) && !currentNote2or4Drs.has(r.dropNumber);
    const otherNoteAllNotesDropoff = priorOtherNoteDrs.has(r.dropNumber) && !currentAnyNoteDrs.has(r.dropNumber);
    return note2or4Dropoff || otherNoteAllNotesDropoff;
  });
}

import { createLogger } from '@/lib/logger';
import pool from '@/lib/db';
import { updateTicket } from '@/modules/noc/services/ticketService';
import { applyTicketResolvedSideEffects } from '@/modules/noc/services/ticketResolutionService';
import { isTerminalStatus } from '@/modules/noc/constants/ticketStatus';
import { TicketStatus } from '@/modules/noc/types/ticket';
import {
  logNonInvoiceableResolved,
  logTicketAutoClosed,
  type NoteCode,
} from '@/modules/activate/services/activity-log/eventLoggers';

const logger = createLogger('billing:oltDropoffClosure');

const SYSTEM_USER_ID =
  process.env.WA_BRIDGE_SYSTEM_USER_ID ?? '81abd560-48ae-414e-ad31-9d82f1a9ed49';
const SYSTEM_ACTOR = { id: SYSTEM_USER_ID, name: 'FibreFlow System', email: 'system@fibreflow.app' };
const DR_HISTORY_ACTOR = 'billing-import';
const RESOLUTION_TYPE = 'ft_note_dropoff';

// Verbatim from pages/api/system/olt-report/records.ts:47 — the Investigate "open" set.
const OPEN_STATUS_PREDICATE =
  `(r.fix_status IN ('not_found','needs_investigation','needs_reinvestigation',` +
  `'empty_serial','rejected','serial_other_dr') OR r.olt_serial IS NULL)`;

export interface OltDropoffInput {
  project: string;
  weekEnding: string; // 'YYYY-MM-DD'
  currentNote2or4Drs: Set<string>;
  currentAnyNoteDrs: Set<string>;
  notesPresent: boolean;
  dryRun: boolean;
}

export interface OltDropoffOutcome {
  evaluated: boolean;
  candidates: { dropNumber: string; ticketUid: string | null }[];
  closedTickets: number;
  resolvedRecords: number;
}

function auditMessage(project: string, weekEnding: string): string {
  return (
    `Auto-cleared: FibreFlow weekly notes for ${project} WE${weekEnding} no longer list ` +
    `this DR under the applicable FT note rule — FiberTime considers the issue resolved. ` +
    `Cleared automatically on notes import.`
  );
}

export async function processOltDropoffClosures(
  input: OltDropoffInput,
): Promise<OltDropoffOutcome> {
  const { project, weekEnding, currentNote2or4Drs, currentAnyNoteDrs, notesPresent, dryRun } = input;
  const empty: OltDropoffOutcome = { evaluated: false, candidates: [], closedTickets: 0, resolvedRecords: 0 };

  // Safety invariant: no authority to declare drop-offs without a notes XLSX.
  if (!notesPresent) return empty;

  // 1. DRs flagged in PRIOR weeks for this project (+ which notes). Split the
  // current note2/note4 behaviour from the new conservative all-notes rule.
  const priorRes = await pool.query<{ dr_number: string; deduction_note: NoteCode }>(
    `SELECT DISTINCT dr_number, deduction_note
       FROM ft_billing_deductions
      WHERE project = $1
        AND deduction_note IN ('note1','note2','note3','note4','note5')
        AND week_ending < $2::date`,
    [project, weekEnding],
  );
  const priorNote2or4Drs = new Set<string>();
  const priorOtherNoteDrs = new Set<string>();
  const priorNotesByDr = new Map<string, NoteCode[]>();
  for (const row of priorRes.rows) {
    if (row.deduction_note === 'note2' || row.deduction_note === 'note4') {
      priorNote2or4Drs.add(row.dr_number);
    } else {
      priorOtherNoteDrs.add(row.dr_number);
    }
    const notes = priorNotesByDr.get(row.dr_number) ?? [];
    if (!notes.includes(row.deduction_note)) notes.push(row.deduction_note);
    priorNotesByDr.set(row.dr_number, notes);
  }

  const note2or4DroppedOff = [...priorNote2or4Drs].filter((dr) => !currentNote2or4Drs.has(dr));
  const otherNotesDroppedOffAllNotes = [...priorOtherNoteDrs].filter((dr) => !currentAnyNoteDrs.has(dr));
  const droppedOff = [...new Set([...note2or4DroppedOff, ...otherNotesDroppedOffAllNotes])];
  if (droppedOff.length === 0) return { ...empty, evaluated: true };

  // 2. Currently-OPEN mismatch records among the dropped-off DRs.
  const openRes = await pool.query<{
    id: string; drop_number: string; maintenance_ticket_id: string | null;
    ticket_uid: string | null; ticket_status: string | null;
  }>(
    `SELECT r.id, r.drop_number, r.maintenance_ticket_id,
            mt.ticket_uid, mt.status AS ticket_status
       FROM olt_mismatch_records r
       LEFT JOIN maintenance_tickets mt ON r.maintenance_ticket_id = mt.id
      WHERE r.drop_number = ANY($1::varchar[])
        AND ${OPEN_STATUS_PREDICATE}`,
    [droppedOff],
  );
  const openRecords = openRes.rows.map((row) => ({
    id: row.id,
    dropNumber: row.drop_number,
    maintenanceTicketId: row.maintenance_ticket_id,
    ticketUid: row.ticket_uid,
    ticketStatus: row.ticket_status,
  }));

  const targets = computeDropOffClosures(
    priorNote2or4Drs,
    currentNote2or4Drs,
    openRecords,
    priorOtherNoteDrs,
    currentAnyNoteDrs,
  );

  const outcome: OltDropoffOutcome = {
    evaluated: true,
    candidates: targets.map((t) => ({ dropNumber: t.dropNumber, ticketUid: t.ticketUid })),
    closedTickets: 0,
    resolvedRecords: 0,
  };
  if (dryRun) return outcome;

  const note = auditMessage(project, weekEnding);
  for (const t of targets) {
    try {
      const hasOpenTicket =
        t.maintenanceTicketId != null &&
        t.ticketStatus != null &&
        !isTerminalStatus(t.ticketStatus as TicketStatus);

      if (hasOpenTicket) {
        // Close the ticket → cascade writes the ticket note AND resolves the
        // linked record (markLinkedDataSyncResolved). Then stamp the record's
        // resolution_type/notes with the FT-specific reason (cascade sets a
        // generic 'ticket_closed').
        const updated = await updateTicket(t.maintenanceTicketId!, {
          status: TicketStatus.RESOLVED,
          resolved_at: new Date().toISOString(),
        });
        await applyTicketResolvedSideEffects(updated, {
          actingUser: SYSTEM_ACTOR,
          note,
          noteVisibility: 'public',
        });
        await pool.query(
          `UPDATE olt_mismatch_records
              SET resolution_type = $2, resolution_notes = $3
            WHERE id = $1`,
          [t.id, RESOLUTION_TYPE, note],
        );
        await logTicketAutoClosed(
          t.dropNumber,
          {
            ticketId: updated.id,
            ticketUid: updated.ticket_uid ?? t.ticketUid ?? '',
            triggeringEvent: 'ft_note_dropoff',
            ruleName: 'weekly_notes_dropoff_autoclose',
          },
          DR_HISTORY_ACTOR,
        );
        // Only count a close that actually happened (updateTicket returned a ticket).
        if (updated) outcome.closedTickets += 1;
      } else {
        // Unticketed (or ticket already terminal) → resolve the record directly.
        const res = await pool.query(
          `UPDATE olt_mismatch_records
              SET fix_status = 'resolved', resolution_type = $2,
                  resolution_notes = $3, resolved_by = $4::uuid, resolved_at = NOW()
            WHERE id = $1 AND fix_status NOT IN ('fixed','resolved')`,
          [t.id, RESOLUTION_TYPE, note, SYSTEM_USER_ID],
        );
        // Record may have been fixed/resolved since the open-records query ran;
        // only count a row we actually updated.
        if ((res?.rowCount ?? 0) > 0) outcome.resolvedRecords += 1;
      }

      // DR history — one entry per prior note2/note4 the DR carried.
      for (const noteCode of priorNotesByDr.get(t.dropNumber) ?? []) {
        await logNonInvoiceableResolved(
          t.dropNumber,
          { weekEnding, noteCode, resolutionReason: 'ft_note_dropoff' },
          DR_HISTORY_ACTOR,
        );
      }
    } catch (err) {
      logger.warn('OLT drop-off close failed for one record (continuing)', {
        recordId: t.id, dropNumber: t.dropNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return outcome;
}
