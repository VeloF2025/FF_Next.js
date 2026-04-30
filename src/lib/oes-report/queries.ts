import { pool } from '@/lib/db';

export interface AllRow {
  drop_number: string;
  serial_number: string | null;
  activation_date: string | null;
  activation_datetime: string | null;
  olt_address: string | null;
  ont_rx_sig_dbm: number | null;
  link_budget_ont_olt_db: number | null;
  olt_rx_sig_dbm: number | null;
  link_budget_olt_ont_db: number | null;
  status: string | null;
  latitude: number | null;
  longitude: number | null;
  current_ont_rx: number | null;
  team: string | null;
}

export interface PpRow {
  project: string | null;
  serial_number: string | null;
  date_registered: string | null;
}

export interface PpSiteCount {
  project: string;
  count: number;
}

export interface WaOnlyRow {
  drop_number: string;
  submitted_date: string | null;
  ont_serial_scanned: string | null;
  sender_phone: string | null;
}

export interface OesOnlyRow {
  drop_number: string;
  serial_number: string | null;
  activation_date: string | null;
  team: string | null;
  status: string | null;
}

export interface TicketRow {
  id: string;
  ticket_uid: string;
  dr_number: string | null;
  ont_serial: string | null;
  status: string | null;
}

export type TicketMap = Map<string, TicketRow[]>;

export async function loadAllActivations(): Promise<AllRow[]> {
  const result = await pool.query<AllRow>(`
    SELECT drop_number, serial_number, activation_date, activation_datetime, olt_address,
           ont_rx_sig_dbm, link_budget_ont_olt_db, olt_rx_sig_dbm, link_budget_olt_ont_db,
           status, latitude, longitude, current_ont_rx, team
    FROM oes_activations
    ORDER BY team NULLS LAST, drop_number
  `);
  return result.rows;
}

export async function loadPpData(): Promise<PpRow[]> {
  // Only show serials with no resolution yet. Any other status (located_*, activated)
  // means the serial has been matched — activated ones appear in the FT Dispute tab.
  const result = await pool.query<PpRow>(`
    SELECT project, serial_number, date_registered
    FROM oes_pp_data
    WHERE resolution_status = 'not_found'
    ORDER BY project NULLS LAST, date_registered NULLS LAST
  `);
  return result.rows;
}

export async function loadPpSiteCounts(): Promise<PpSiteCount[]> {
  const result = await pool.query<PpSiteCount>(`
    SELECT project, COUNT(*)::int AS count
    FROM oes_pp_data
    WHERE project IS NOT NULL
      AND resolution_status = 'not_found'
    GROUP BY project
    ORDER BY project
  `);
  return result.rows;
}

export interface FtDisputeRow {
  serial_number: string;
  project: string | null;
  date_registered: string | null;
  drop_number: string;
  activation_date: string | null;
  team: string | null;
  activation_status: string | null;
}

export async function loadFtDisputeRows(): Promise<FtDisputeRow[]> {
  // Serials that appear in Fibertime's LATEST PP DATA import for each project
  // AND are already activated in OES. Scoping to the latest batch per project
  // avoids showing historical rows that Fibertime already removed from their list.
  const result = await pool.query<FtDisputeRow>(`
    WITH latest_batch_per_project AS (
      SELECT project, MAX(import_batch_id) AS latest_batch_id
      FROM oes_pp_data
      WHERE project IS NOT NULL
      GROUP BY project
    )
    SELECT p.serial_number, p.project, p.date_registered::text,
           a.drop_number, a.activation_date::text, a.team, a.status AS activation_status
    FROM oes_pp_data p
    JOIN oes_activations a ON LOWER(a.serial_number) = LOWER(p.serial_number)
    JOIN latest_batch_per_project lb
      ON p.project = lb.project AND p.import_batch_id = lb.latest_batch_id
    ORDER BY a.activation_date DESC NULLS LAST, p.project
  `);
  return result.rows;
}

export async function loadWaOnlyRows(): Promise<WaOnlyRow[]> {
  const result = await pool.query<WaOnlyRow>(`
    SELECT u.drop_number, u.submitted_date::text, u.ont_serial_scanned, u.sender_phone
    FROM dr_photo_unified_reviews u
    LEFT JOIN oes_activations a ON LOWER(a.drop_number) = LOWER(u.drop_number)
    WHERE u.submitted_date IS NOT NULL
      AND a.drop_number IS NULL
    ORDER BY u.submitted_date DESC
  `);
  return result.rows;
}

export async function loadOesOnlyRows(): Promise<OesOnlyRow[]> {
  const result = await pool.query<OesOnlyRow>(`
    SELECT a.drop_number, a.serial_number, a.activation_date::text, a.team, a.status
    FROM oes_activations a
    LEFT JOIN dr_photo_unified_reviews u
           ON LOWER(u.drop_number) = LOWER(a.drop_number) AND u.submitted_date IS NOT NULL
    WHERE u.drop_number IS NULL
    ORDER BY a.activation_date DESC NULLS LAST
  `);
  return result.rows;
}

export async function loadTicketsForKeys(
  drNumbers: string[],
  ontSerials: string[]
): Promise<TicketMap> {
  const map: TicketMap = new Map();
  if (drNumbers.length === 0 && ontSerials.length === 0) return map;

  const result = await pool.query<TicketRow>(`
    SELECT id::text, ticket_uid, dr_number, ont_serial, status
    FROM maintenance_tickets
    WHERE dr_number = ANY($1) OR LOWER(ont_serial) = ANY($2)
  `, [drNumbers, ontSerials.map(s => s.toLowerCase())]);

  for (const row of result.rows) {
    const keys: string[] = [];
    if (row.dr_number) keys.push(row.dr_number.toUpperCase());
    if (row.ont_serial) keys.push(row.ont_serial.toUpperCase());
    for (const key of keys) {
      const existing = map.get(key) ?? [];
      existing.push(row);
      map.set(key, existing);
    }
  }
  return map;
}
