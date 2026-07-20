/**
 * OLT match reconciliation — post-OES-import sweep of open Note 2 / Note 4
 * mismatch records against live 1Map.
 *
 * The nightly queue processor only classifies NEW lookups, and its
 * auto-resolve (`resolveMatchedDrop`) deliberately skips ticketed and
 * needs_investigation rows — so a mismatch that Fibertime later fixes on
 * 1Map stays open forever without a manual re-check. This service closes
 * that gap: for every open record it re-reads 1Map and, when the OES serial
 * (source of truth) is now present on a prop with "Home Installation:
 * Installed" status, resolves the record and drives the full NOC
 * ticket-close cascade — the same shape as the 2026-06-09 and 2026-07-20
 * bulk backfills.
 *
 * Only positive confirmations act: an absent DR, a wrong serial, or a 1Map
 * API failure never mutates anything. Lookups are paced and capped to stay
 * clear of 1Map's cumulative rate limit, and the sweep aborts early after
 * consecutive API failures (rate-limit protocol: stop calling, retry on the
 * next nightly run).
 *
 * Status: WORKING | NLNH Confidence: HIGH
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { oneMapApi, type OneMapRecord } from '@/modules/system/services/oneMapApiService';
import { INSTALLED_STATUS } from './oltMismatchClassifier';

const log = createLogger('OltMatchReconciliation');

/** Open, auto-resolvable states. escalated (human-owned) and pending (live queue) stay out. */
const OPEN_STATES = ['not_found', 'serial_other_dr', 'needs_investigation', 'needs_reinvestigation'];
const TERMINAL_TICKET_STATUSES = ['resolved', 'verified', 'closed', 'cancelled'];

/** Hard cap per sweep — stays well under 1Map's cumulative-call throttle. */
const MAX_LOOKUPS = 300;
const STAGGER_MS = 350;
/** Rows younger than this were classified from a live lookup this cycle — skip. */
const MIN_AGE_HOURS = 12;
const MAX_CONSECUTIVE_FAILURES = 5;

export interface ReconcileResult {
  candidates: number;
  scanned: number;
  confirmed: number;
  recordsResolved: number;
  ticketsClosed: number;
  skippedNoSerial: number;
  apiErrors: number;
  /** Candidates beyond MAX_LOOKUPS left for the next run (never silent). */
  capped: number;
  abortedEarly: boolean;
}

interface CandidateRow {
  id: string;
  drop_number: string;
  olt_serial: string | null;
  maintenance_ticket_id: string | null;
  oes_serial: string | null;
}

interface SystemUser {
  id: string;
  email: string;
}

/**
 * A record is confirmed resolved when 1Map holds the OES serial on a prop
 * that reached installed status. Deliberately laxer than
 * `classifyOltRecords`: a stale wrong serial on a *different* prop (e.g. an
 * old sign-up transaction) must not block resolution once the installation
 * prop is correct — invoicing reads the installed prop.
 */
export function hasConfirmedInstalledMatch(
  records: OneMapRecord[],
  rawOesSerial: string,
): boolean {
  const oesSerial = rawOesSerial.trim().toUpperCase();
  if (!oesSerial) return false;
  return records.some(
    (r) => (r.ph_ont || '').trim().toUpperCase() === oesSerial && r.status === INSTALLED_STATUS,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Never hardcode the system user UUID — resolve it live (see memory: maint system actor). */
async function getSystemUser(): Promise<SystemUser | null> {
  const { rows } = await pool.query(
    `SELECT id, email FROM users WHERE email = 'system@fibreflow.app' LIMIT 1`,
  );
  return rows.length > 0 ? (rows[0] as SystemUser) : null;
}

type TicketCloseOutcome = 'closed' | 'already_terminal' | 'failed';

/**
 * Close a linked NOC ticket through the same cascade the manual OLT resolve
 * uses (#1909): status flip + change log + note/activity/data-sync/AI-summary
 * side-effects. Best-effort — the record is already resolved; a ticket-close
 * failure is logged, never thrown.
 */
async function closeLinkedTicket(
  ticketId: string,
  note: string,
  systemUser: SystemUser | null,
): Promise<TicketCloseOutcome> {
  try {
    const { getTicketById, updateTicket, logTicketChanges } = await import(
      '@/modules/noc/services/ticketService'
    );
    const { applyTicketResolvedSideEffects } = await import(
      '@/modules/noc/services/ticketResolutionService'
    );
    const { TicketStatus } = await import('@/modules/noc/types/ticket');

    // getTicketById throws on a missing/invalid ticket — handled by the catch.
    const oldTicket = await getTicketById(ticketId);
    if (TERMINAL_TICKET_STATUSES.includes(oldTicket.status)) return 'already_terminal';

    const updatedTicket = await updateTicket(ticketId, {
      status: TicketStatus.RESOLVED,
      resolved_at: new Date().toISOString(),
    });
    await logTicketChanges({
      ticketId,
      oldTicket: oldTicket as unknown as Record<string, unknown>,
      newTicket: updatedTicket as unknown as Record<string, unknown>,
      payload: { status: TicketStatus.RESOLVED },
      userId: systemUser?.id,
      userName: 'system',
      userEmail: systemUser?.email,
    });
    await applyTicketResolvedSideEffects(updatedTicket, {
      actingUser: { id: systemUser?.id, name: 'system', email: systemUser?.email },
      note,
      noteVisibility: 'public',
    });
    return 'closed';
  } catch (err) {
    log.warn('Linked ticket close failed (non-blocking)', {
      ticketId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'failed';
  }
}

/**
 * Sweep open mismatch records and resolve the ones 1Map now confirms.
 * Sequential and paced — never called concurrently with itself (single
 * nightly trigger after the OES import's queue processing).
 */
export async function reconcileConfirmedMatches(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    candidates: 0,
    scanned: 0,
    confirmed: 0,
    recordsResolved: 0,
    ticketsClosed: 0,
    skippedNoSerial: 0,
    apiErrors: 0,
    capped: 0,
    abortedEarly: false,
  };

  const { rows } = await pool.query<CandidateRow>(
    `SELECT r.id, r.drop_number, r.olt_serial, r.maintenance_ticket_id,
            oes.serial_number AS oes_serial
     FROM olt_mismatch_records r
     LEFT JOIN LATERAL (
       SELECT serial_number FROM oes_activations
       WHERE drop_number = r.drop_number
       ORDER BY created_at DESC LIMIT 1
     ) oes ON true
     WHERE r.fix_status = ANY($1)
       AND r.created_at < NOW() - INTERVAL '${MIN_AGE_HOURS} hours'
     ORDER BY r.created_at`,
    [OPEN_STATES],
  );

  result.candidates = rows.length;
  result.capped = Math.max(0, rows.length - MAX_LOOKUPS);
  const targets = rows.slice(0, MAX_LOOKUPS);
  if (result.capped > 0) {
    log.warn(`Candidate list capped at ${MAX_LOOKUPS}; ${result.capped} deferred to next run`);
  }
  log.info(`Reconciling ${targets.length} open mismatch records against 1Map`);

  const systemUser = await getSystemUser();
  let consecutiveFailures = 0;

  for (const row of targets) {
    // OES is the source of truth — prefer the latest activation serial over
    // the serial captured at detection time.
    const oesSerial = (row.oes_serial || row.olt_serial || '').trim().toUpperCase();
    if (!oesSerial) {
      result.skippedNoSerial++;
      continue;
    }

    const search = await oneMapApi.searchDR(row.drop_number);
    await sleep(STAGGER_MS);
    if (!search.success) {
      result.apiErrors++;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        result.abortedEarly = true;
        log.warn(`Aborting after ${consecutiveFailures} consecutive 1Map failures`, {
          lastError: search.error,
        });
        break;
      }
      continue;
    }
    consecutiveFailures = 0;
    result.scanned++;

    if (!hasConfirmedInstalledMatch(search.records, oesSerial)) continue;
    result.confirmed++;

    const note =
      `Auto-resolved from OLT re-check: ${row.drop_number} now matches 1Map ` +
      `(ONT ${oesSerial}) with "${INSTALLED_STATUS}" status. Daily reconciliation after OES import.`;

    // Guarded on current state so a concurrent manual resolve/escalate wins.
    const upd = await pool.query(
      `UPDATE olt_mismatch_records
       SET fix_status = 'resolved',
           resolution_type = 'auto_verified_match',
           resolution_notes = $1,
           resolved_at = NOW(),
           resolved_by = $2
       WHERE id = $3 AND fix_status = ANY($4)`,
      [note, systemUser?.id ?? null, row.id, OPEN_STATES],
    );
    if (upd.rowCount === 0) continue;
    result.recordsResolved++;

    if (row.maintenance_ticket_id) {
      const outcome = await closeLinkedTicket(row.maintenance_ticket_id, note, systemUser);
      if (outcome === 'closed') result.ticketsClosed++;
    }
  }

  log.info('OLT match reconciliation done', { data: result });
  return result;
}
