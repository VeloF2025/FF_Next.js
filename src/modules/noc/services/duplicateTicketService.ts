/**
 * Duplicate Ticket Detection
 *
 * Before creating a new ticket for a non-invoiceable item (offline ONT,
 * pre-provision PP data, OLT mismatch), check whether an OPEN maintenance
 * ticket already covers the same DR, ONT serial, or pole. This prevents
 * duplicate tickets across the weekly-billing, NOC, and auto-ingest flows.
 */

import pool from '@/lib/db';

/**
 * Statuses considered "still open" — a ticket in any other status is a
 * match-worthy duplicate. `verified` and `resolved` sometimes precede a
 * formal close so they are excluded as well; once those lifecycles end we
 * expect a `closed` status.
 */
export const OPEN_TICKET_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'pending_qa',
  'qa_in_progress',
  'qa_rejected',
  'qa_approved',
  'pending_handover',
  'handed_to_ops',
] as const;

export interface DuplicateCheckInput {
  drNumber?: string | null;
  ontSerial?: string | null;
  poleNumber?: string | null;
}

export interface DuplicateTicket {
  id: string;
  ticket_uid: string;
  title: string;
  status: string;
  type: string;
  ticket_category: string | null;
  dr_number: string | null;
  ont_serial: string | null;
  created_at: string;
  match_reasons: Array<'dr_number' | 'ont_serial' | 'pole_number'>;
}

/**
 * Find open tickets that collide with the given identifiers.
 *
 * Matching is a UNION of three independent predicates — any one hit makes
 * the ticket a duplicate. `match_reasons` is an aggregated array so the
 * UI can show the user *why* a ticket was flagged.
 *
 * Pole matching uses a sub-query through `drops.pole_number` because
 * `maintenance_tickets` has no pole_number column of its own; the link is
 * the DR → drop → pole lookup.
 */
export async function findDuplicateTickets(
  input: DuplicateCheckInput,
): Promise<DuplicateTicket[]> {
  const dr = input.drNumber?.trim() || null;
  const serial = input.ontSerial?.trim() || null;
  let pole = input.poleNumber?.trim() || null;

  if (!dr && !serial && !pole) {
    return [];
  }

  // If the caller gave us a DR but no pole, look up the pole from `drops`
  // so the pole-match predicate has something to work with. This lets the
  // non-invoiceables UI pass only (dr, serial) and still get pole-based
  // cross-DR matches (e.g. same ONT reinstalled on a different DR).
  if (dr && !pole) {
    try {
      const { rows } = await pool.query(
        `SELECT pole_number FROM drops WHERE drop_number = $1 LIMIT 1`,
        [dr],
      );
      if (rows[0]?.pole_number) {
        pole = String(rows[0].pole_number);
      }
    } catch {
      // enrichment is best-effort — continue without pole matching
    }
  }

  const { rows } = await pool.query(
    `
    WITH matches AS (
      SELECT id, 'dr_number'::text AS reason
        FROM maintenance_tickets
       WHERE $1::text IS NOT NULL
         AND dr_number = $1
         AND status = ANY($4::text[])
      UNION ALL
      SELECT id, 'ont_serial'::text
        FROM maintenance_tickets
       WHERE $2::text IS NOT NULL
         AND ont_serial = $2
         AND status = ANY($4::text[])
      UNION ALL
      SELECT id, 'pole_number'::text
        FROM maintenance_tickets
       WHERE $3::text IS NOT NULL
         AND dr_number IN (
           SELECT drop_number FROM drops WHERE pole_number = $3
         )
         AND status = ANY($4::text[])
    )
    SELECT t.id::text,
           t.ticket_uid,
           t.title,
           t.status,
           t.type,
           t.ticket_category,
           t.dr_number,
           t.ont_serial,
           t.created_at,
           array_agg(DISTINCT m.reason) AS match_reasons
      FROM matches m
      JOIN maintenance_tickets t ON t.id = m.id
     GROUP BY t.id
     ORDER BY t.created_at DESC
     LIMIT 20
    `,
    [dr, serial, pole, OPEN_TICKET_STATUSES as unknown as string[]],
  );

  return rows.map((r): DuplicateTicket => ({
    id: r.id,
    ticket_uid: r.ticket_uid,
    title: r.title,
    status: r.status,
    type: r.type,
    ticket_category: r.ticket_category,
    dr_number: r.dr_number,
    ont_serial: r.ont_serial,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    match_reasons: r.match_reasons,
  }));
}

export type LinkSourceTable =
  | 'offline_devices.mismatch_ticket_id'
  | 'offline_devices.offline_ticket_id'
  | 'oes_pp_data.maintenance_ticket_id'
  | 'olt_mismatch_records.maintenance_ticket_id';

/**
 * Link a non-invoiceable source row to an existing maintenance ticket.
 * Sets the appropriate ticket-id FK on the source table. Caller is
 * responsible for adding a maintenance_activities / maintenance_notes
 * entry on the ticket so the link is visible in the ticket history.
 */
export async function linkSourceToTicket(
  sourceTable: LinkSourceTable,
  sourceId: string,
  ticketId: string,
): Promise<{ updated: boolean }> {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(ticketId)) {
    throw new Error('ticketId must be a UUID');
  }

  let sql: string;
  let idParam: string | number = sourceId;

  switch (sourceTable) {
    case 'offline_devices.mismatch_ticket_id':
      sql = `UPDATE offline_devices
                SET mismatch_ticket_id = $1,
                    mismatch_status = COALESCE(mismatch_status, 'ticket_created')
              WHERE id = $2 AND mismatch_ticket_id IS NULL`;
      break;
    case 'offline_devices.offline_ticket_id':
      sql = `UPDATE offline_devices
                SET offline_ticket_id = $1,
                    offline_ticket_created_at = COALESCE(offline_ticket_created_at, now())
              WHERE id = $2 AND offline_ticket_id IS NULL`;
      break;
    case 'oes_pp_data.maintenance_ticket_id':
      sql = `UPDATE oes_pp_data
                SET maintenance_ticket_id = $1
              WHERE id = $2 AND maintenance_ticket_id IS NULL`;
      idParam = Number(sourceId);
      break;
    case 'olt_mismatch_records.maintenance_ticket_id':
      sql = `UPDATE olt_mismatch_records
                SET maintenance_ticket_id = $1,
                    fix_status = COALESCE(fix_status, 'ticket_created')
              WHERE id = $2 AND maintenance_ticket_id IS NULL`;
      idParam = Number(sourceId);
      break;
  }

  const res = await pool.query(sql, [ticketId, idParam]);
  return { updated: (res.rowCount ?? 0) > 0 };
}
