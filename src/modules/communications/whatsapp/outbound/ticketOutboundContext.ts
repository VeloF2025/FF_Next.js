import { query, type SqlRow } from '@/lib/db-pool';

// The per-ticket facts a business-initiated send needs: who to reach, and which
// FNO's brand the message speaks for. Both come off maintenance_tickets, so they
// are read in one statement rather than two round trips.

export interface TicketOutboundContext {
  ticketId: string;
  /** Free-form contact field off the ticket; may hold a name, a number, or both. */
  clientContact: string | null;
  /** Contact recovered from the drop's 1Map property record. */
  onemapContact: string | null;
  /** Resolved FNO company name, or null when unresolved. Never a placeholder. */
  fno: string | null;
  /**
   * Values the approved templates interpolate. Read here, server-side, so the copy a
   * subscriber receives is assembled entirely from the ticket — a caller cannot supply
   * or influence any of it.
   */
  clientName: string | null;
  address: string | null;
  drNumber: string | null;
  loggedAt: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
}

interface ContextRow {
  client_contact: string | null;
  onemap_contact: string | null;
  fno: string | null;
  client_name: string | null;
  address: string | null;
  dr_number: string | null;
  logged_at: string | null;
  due_at: string | null;
  resolved_at: string | null;
}

// Notes on the joins, both of which are load-bearing:
//
//  * projects is joined as `p.id::text = mt.project_id`, casting the UUID down to
//    text rather than casting project_id up. maintenance_tickets.project_id is a
//    TEXT column and 7 rows in it are not UUIDs, so `mt.project_id::uuid` raises
//    22P02 and takes out the whole lookup. Comparing as text simply fails to
//    match for those rows, which is the outcome we want: unresolved, not thrown.
//
//  * onemap_properties holds several rows per drop_number, so a plain join
//    multiplies the ticket row. The LATERAL picks a single non-blank contact,
//    ordered so the choice is deterministic across calls rather than whatever
//    the heap returns first.
//
// This recovers a contact for roughly 36% of tickets versus 4% from
// client_contact alone, which is the difference between the guard being usable
// and it blocking nearly everything.
// Timestamps are formatted in SQL, in Africa/Johannesburg. A subscriber-facing
// "Logged: ..." line must read as local time; handing back a raw UTC timestamptz and
// letting the template stringify it would show the wrong hour for two months of the
// year and an ISO suffix no subscriber should see.
const CONTEXT_SQL = `
  SELECT
    NULLIF(TRIM(COALESCE(mt.client_contact, '')), '')   AS client_contact,
    NULLIF(TRIM(COALESCE(op.contact_number, '')), '')   AS onemap_contact,
    NULLIF(TRIM(COALESCE(c.company_name, '')), '')      AS fno,
    NULLIF(TRIM(COALESCE(mt.client_name, '')), '')      AS client_name,
    NULLIF(TRIM(COALESCE(mt.address, '')), '')          AS address,
    NULLIF(TRIM(COALESCE(mt.dr_number, '')), '')        AS dr_number,
    TO_CHAR(mt.created_at  AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI') AS logged_at,
    TO_CHAR(mt.due_at      AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI') AS due_at,
    TO_CHAR(mt.resolved_at AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI') AS resolved_at
  FROM maintenance_tickets mt
  LEFT JOIN projects p ON p.id::text = mt.project_id
  LEFT JOIN clients  c ON c.id = p.client_id
  LEFT JOIN LATERAL (
    SELECT o.contact_number
      FROM onemap_properties o
     WHERE o.drop_number = mt.dr_number
       AND NULLIF(TRIM(COALESCE(o.contact_number, '')), '') IS NOT NULL
     ORDER BY o.contact_number
     LIMIT 1
  ) op ON TRUE
  WHERE mt.id = $1
  LIMIT 1
`;

/**
 * Read the outbound context for a ticket, or null when no such ticket exists.
 *
 * Blank strings are collapsed to NULL in SQL so that an empty client_contact or
 * an FNO recorded as '' cannot reach a caller as a present-but-meaningless
 * value and end up interpolated into a template.
 */
export async function getTicketOutboundContext(
  ticketId: string,
): Promise<TicketOutboundContext | null> {
  const rows = await query<ContextRow & SqlRow>(CONTEXT_SQL, [ticketId]);
  const row = rows[0];
  if (!row) return null;

  return {
    ticketId,
    clientContact: row.client_contact ?? null,
    onemapContact: row.onemap_contact ?? null,
    fno: row.fno ?? null,
    clientName: row.client_name ?? null,
    address: row.address ?? null,
    drNumber: row.dr_number ?? null,
    loggedAt: row.logged_at ?? null,
    dueAt: row.due_at ?? null,
    resolvedAt: row.resolved_at ?? null,
  };
}

/**
 * Resolve the FNO a ticket belongs to, via project_id -> projects.client_id ->
 * clients.company_name.
 *
 * Returns null whenever the chain does not complete — no project_id, a
 * project_id matching no project, a project with no client, or a client whose
 * company_name is blank. Around 23% of tickets carry no project_id at all, so
 * null is an ordinary outcome and not an error. It is never substituted with a
 * placeholder or an empty string: a template naming a blank or guessed brand is
 * the failure this exists to prevent.
 */
export async function resolveFnoForTicket(ticketId: string): Promise<string | null> {
  const context = await getTicketOutboundContext(ticketId);
  return context?.fno ?? null;
}
