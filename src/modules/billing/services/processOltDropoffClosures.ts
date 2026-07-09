// src/modules/billing/services/processOltDropoffClosures.ts
/**
 * Auto-clear NOC tickets / OLT Investigate records when FibreTime's weekly notes
 * show that a previously flagged DR no longer needs investigation.
 *
 * Called best-effort from the weekly billing bundle import (and as a read-only
 * dry-run on preview). For one project + week it:
 *   1. identifies DRs that appeared on any prior weekly Notes sheet;
 *   2. closes only when the DR is absent from ALL current weekly notes;
 *   3. closes every open maintenance ticket for that DR, regardless of source;
 *   4. closes linked Data Sync records via the standard ticket-resolution
 *      cascade and directly resolves unticketed OLT records.
 *
 * Trust model: FT dropping the relevant note/sheet entry is treated as
 * authoritative. Self-healing: a later re-deduction is re-detected by the OLT
 * report import and flagged not_returned by processExpectedRecoveries.
 */

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
 * - Any prior weekly note means the DR was FT-flagged before.
 * - Close only when the DR is absent from ALL current weekly notes. This avoids
 *   closing a DR that merely moved from one note sheet to another.
 *
 * The prior gate ensures we never touch records open purely from auto-detection
 * and never FT-flagged.
 */
export function computeDropOffClosures(
  priorNoteDrs: Set<string>,
  currentAnyNoteDrs: Set<string>,
  openRecords: OpenMismatchRecord[],
): OpenMismatchRecord[] {
  return openRecords.filter((r) => priorNoteDrs.has(r.dropNumber) && !currentAnyNoteDrs.has(r.dropNumber));
}

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

async function logPriorNotesOnce(
  dropNumber: string,
  weekEnding: string,
  priorNotesByDr: Map<string, NoteCode[]>,
): Promise<void> {
  for (const noteCode of priorNotesByDr.get(dropNumber) ?? []) {
    await logNonInvoiceableResolved(
      dropNumber,
      { weekEnding, noteCode, resolutionReason: 'ft_note_dropoff' },
      DR_HISTORY_ACTOR,
    );
  }
}

export async function processOltDropoffClosures(
  input: OltDropoffInput,
): Promise<OltDropoffOutcome> {
  const { project, weekEnding, currentAnyNoteDrs, notesPresent, dryRun } = input;
  const empty: OltDropoffOutcome = { evaluated: false, candidates: [], closedTickets: 0, resolvedRecords: 0 };

  // Safety invariant: no authority to declare drop-offs without a notes XLSX.
  if (!notesPresent) return empty;

  // 1. DRs flagged in PRIOR weeks for this project (+ which notes).
  const priorRes = await pool.query<{ dr_number: string; deduction_note: NoteCode }>(
    `SELECT DISTINCT dr_number, deduction_note
       FROM ft_billing_deductions
      WHERE project = $1
        AND deduction_note IN ('note1','note2','note3','note4','note5')
        AND week_ending < $2::date`,
    [project, weekEnding],
  );
  const priorNoteDrs = new Set<string>();
  const priorNotesByDr = new Map<string, NoteCode[]>();
  for (const row of priorRes.rows) {
    priorNoteDrs.add(row.dr_number);
    const notes = priorNotesByDr.get(row.dr_number) ?? [];
    if (!notes.includes(row.deduction_note)) notes.push(row.deduction_note);
    priorNotesByDr.set(row.dr_number, notes);
  }

  const droppedOff = [...priorNoteDrs].filter((dr) => !currentAnyNoteDrs.has(dr));
  if (droppedOff.length === 0) return { ...empty, evaluated: true };

  // 2. Every OPEN maintenance ticket for dropped-off DRs — this is the business
  //    rule: if the DR disappeared from weekly notes, all corresponding tickets
  //    for that DR should close, not only tickets linked to OLT rows.
  const ticketRes = await pool.query<{
    maintenance_ticket_id: string;
    drop_number: string;
    ticket_uid: string | null;
    ticket_status: string | null;
  }>(
    `SELECT id AS maintenance_ticket_id, dr_number AS drop_number,
            ticket_uid, status AS ticket_status
       FROM maintenance_tickets
      WHERE dr_number = ANY($1::text[])
        AND status NOT IN ('resolved','cancelled','verified','closed')
      ORDER BY dr_number, created_at`,
    [droppedOff],
  );
  const openTicketRecords = ticketRes.rows.map((row) => ({
    id: row.maintenance_ticket_id,
    dropNumber: row.drop_number,
    maintenanceTicketId: row.maintenance_ticket_id,
    ticketUid: row.ticket_uid,
    ticketStatus: row.ticket_status,
  }));

  const ticketTargets = computeDropOffClosures(
    priorNoteDrs,
    currentAnyNoteDrs,
    openTicketRecords,
  );

  // 3. Unticketed currently-OPEN mismatch records among the dropped-off DRs.
  //    Ticketed rows are resolved through applyTicketResolvedSideEffects above.
  const unticketedRes = await pool.query<{
    id: string; drop_number: string;
  }>(
    `SELECT r.id, r.drop_number
       FROM olt_mismatch_records r
      WHERE r.drop_number = ANY($1::varchar[])
        AND r.maintenance_ticket_id IS NULL
        AND ${OPEN_STATUS_PREDICATE}`,
    [droppedOff],
  );
  const unticketedRecords = unticketedRes.rows.map((row) => ({
    id: row.id,
    dropNumber: row.drop_number,
    maintenanceTicketId: null,
    ticketUid: null,
    ticketStatus: null,
  }));

  const unticketedTargets = computeDropOffClosures(
    priorNoteDrs,
    currentAnyNoteDrs,
    unticketedRecords,
  );

  const targets = [...ticketTargets, ...unticketedTargets];
  const outcome: OltDropoffOutcome = {
    evaluated: true,
    candidates: targets.map((t) => ({ dropNumber: t.dropNumber, ticketUid: t.ticketUid })),
    closedTickets: 0,
    resolvedRecords: 0,
  };
  if (dryRun) return outcome;

  const note = auditMessage(project, weekEnding);
  const loggedDropNumbers = new Set<string>();
  for (const t of targets) {
    try {
      const hasOpenTicket =
        t.maintenanceTicketId != null &&
        t.ticketStatus != null &&
        !isTerminalStatus(t.ticketStatus as TicketStatus);

      if (hasOpenTicket) {
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
            WHERE maintenance_ticket_id = $1`,
          [t.maintenanceTicketId, RESOLUTION_TYPE, note],
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
        if (updated) outcome.closedTickets += 1;
      } else {
        const res = await pool.query(
          `UPDATE olt_mismatch_records
              SET fix_status = 'resolved', resolution_type = $2,
                  resolution_notes = $3, resolved_by = $4::uuid, resolved_at = NOW()
            WHERE id = $1 AND fix_status NOT IN ('fixed','resolved')`,
          [t.id, RESOLUTION_TYPE, note, SYSTEM_USER_ID],
        );
        if ((res?.rowCount ?? 0) > 0) outcome.resolvedRecords += 1;
      }

      if (!loggedDropNumbers.has(t.dropNumber)) {
        await logPriorNotesOnce(t.dropNumber, weekEnding, priorNotesByDr);
        loggedDropNumbers.add(t.dropNumber);
      }
    } catch (err) {
      logger.warn('Weekly note drop-off close failed for one target (continuing)', {
        recordId: t.id,
        dropNumber: t.dropNumber,
        ticketUid: t.ticketUid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return outcome;
}
