import { pool } from '@/lib/db';

export const SITES = ['LAW', 'MAM', 'MOA', 'TEM', 'TEM-3'] as const;
export type SiteCode = (typeof SITES)[number];

const SITE_LABELS: Record<string, string> = {
  LAW: 'Lawley',
  MAM: 'Mamelodi',
  MOA: 'Mohadin',
  TEM: 'Tembisa POP 1',
  'TEM-3': 'Tembisa POP 3',
};

// Mapping from oes_pp_data.project values (post-import) to canonical site code.
// Importer rewrites LAW/MOA/MAM via PP_PROJECT_CODE_MAP; TEM/TEM-3 stay as-is.
const PP_PROJECT_TO_SITE: Record<string, SiteCode> = {
  Lawley: 'LAW',
  Mamelodi: 'MAM',
  Mohadin: 'MOA',
  TEM: 'TEM',
  'TEM-3': 'TEM-3',
};

export function siteLabel(code: string): string {
  return SITE_LABELS[code] ?? code;
}

export function ppProjectToSite(project: string | null | undefined): SiteCode | null {
  if (!project) return null;
  return PP_PROJECT_TO_SITE[project] ?? null;
}

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
  resolution_status: string | null;
  resolved_drop_number: string | null;
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

/**
 * Every PP serial in Fibertime's latest publish per project, regardless of
 * resolution status. Scoped to the latest import batch per project so historic
 * rows that FT has since removed don't appear.
 */
export async function loadPpData(): Promise<PpRow[]> {
  const result = await pool.query<PpRow>(`
    WITH latest_batch_per_project AS (
      SELECT project, MAX(import_batch_id) AS bid
      FROM oes_pp_data
      WHERE project IS NOT NULL
      GROUP BY project
    )
    SELECT p.project, p.serial_number, p.date_registered::text,
           p.resolution_status, p.resolved_drop_number
    FROM oes_pp_data p
    JOIN latest_batch_per_project lb
      ON p.project = lb.project AND p.import_batch_id = lb.bid
    ORDER BY p.project NULLS LAST, p.date_registered NULLS LAST, p.serial_number
  `);
  return result.rows;
}

export async function loadFtDisputeRows(): Promise<FtDisputeRow[]> {
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

export async function loadLatestOesReportDate(): Promise<string> {
  const result = await pool.query<{ report_date: string }>(`
    SELECT report_date::text
    FROM oes_import_batches
    WHERE report_date IS NOT NULL
    ORDER BY report_date DESC
    LIMIT 1
  `);
  return result.rows[0]?.report_date
    ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
}

// ONT_LIFECYCLE_V2 query functions live in queriesV2.ts — import directly from there.

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
