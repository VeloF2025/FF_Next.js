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

// ============================================================================
// DAILY SUMMARY (7-day pivot: site × date × metric)
// ============================================================================

export interface DailyCount {
  day: string;        // YYYY-MM-DD
  site: SiteCode;
  count: number;
}

export interface DailySummary {
  days: string[];                  // 7 dates ascending, YYYY-MM-DD
  sites: SiteCode[];               // canonical site order
  activations: DailyCount[];       // new activations per (day, site)
  ppsNew: DailyCount[];            // new PP rows per (day, site) — by date_registered
  ppsOutstanding: DailyCount[];    // PP stock at end of (day, site) — forward-filled
  disputes: DailyCount[];          // activations on (day, site) whose serial is still in PP
}

// Site code lives at position 4 of 'oes_status_report_<SITE>_YYYYMMDD.xlsx'.
const FILENAME_SITE_SQL = `split_part(b.filename, '_', 4)`;

function buildDays(reportDate: string): string[] {
  const days: string[] = [];
  const end = new Date(`${reportDate}T00:00:00Z`);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export async function loadDailySummary(reportDate: string): Promise<DailySummary> {
  const days = buildDays(reportDate);
  const start = days[0]!;
  const end = days[days.length - 1]!;

  const activationsRes = await pool.query<{ day: string; site: string; n: number }>(`
    SELECT a.activation_date::text AS day,
           ${FILENAME_SITE_SQL} AS site,
           COUNT(*)::int AS n
    FROM oes_activations a
    JOIN oes_import_batches b ON b.id = a.import_batch_id
    WHERE a.activation_date BETWEEN $1::date AND $2::date
    GROUP BY a.activation_date, site
  `, [start, end]);

  const ppsNewRes = await pool.query<{ day: string; project: string; n: number }>(`
    SELECT date_registered::text AS day, project, COUNT(*)::int AS n
    FROM oes_pp_data
    WHERE date_registered BETWEEN $1::date AND $2::date
      AND project IS NOT NULL
    GROUP BY date_registered, project
  `, [start, end]);

  // Forward-fills across non-publish days by picking the latest batch on-or-before each day.
  const ppsOutstandingRes = await pool.query<{ day: string; project: string; n: number }>(`
    WITH days AS (
      SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS day
    ),
    pp_batches AS (
      SELECT pib.id AS batch_id,
             pib.created_at::date AS batch_date,
             CASE
               WHEN pib.filename LIKE 'oes_status_report_LAW_%' THEN 'Lawley'
               WHEN pib.filename LIKE 'oes_status_report_MAM_%' THEN 'Mamelodi'
               WHEN pib.filename LIKE 'oes_status_report_MOA_%' THEN 'Mohadin'
               WHEN pib.filename LIKE 'oes_status_report_TEM-3_%' THEN 'TEM-3'
               WHEN pib.filename LIKE 'oes_status_report_TEM_%' THEN 'TEM'
             END AS project
      FROM oes_pp_import_batches pib
    ),
    project_day AS (
      SELECT DISTINCT pb.project, d.day
      FROM pp_batches pb CROSS JOIN days d
      WHERE pb.project IS NOT NULL
    ),
    latest_batch_per_day AS (
      SELECT pd.project, pd.day,
        (SELECT pb2.batch_id
         FROM pp_batches pb2
         WHERE pb2.project = pd.project AND pb2.batch_date <= pd.day
         ORDER BY pb2.batch_date DESC, pb2.batch_id DESC
         LIMIT 1) AS batch_id
      FROM project_day pd
    )
    SELECT l.day::text, l.project, COALESCE(COUNT(ppd.id), 0)::int AS n
    FROM latest_batch_per_day l
    LEFT JOIN oes_pp_data ppd
      ON ppd.import_batch_id = l.batch_id AND ppd.project = l.project
    GROUP BY l.day, l.project
  `, [start, end]);

  const disputesRes = await pool.query<{ day: string; site: string; n: number }>(`
    WITH latest_batch_per_project AS (
      SELECT project, MAX(import_batch_id) AS bid
      FROM oes_pp_data
      WHERE project IS NOT NULL
      GROUP BY project
    ),
    current_pp_serials AS (
      SELECT DISTINCT LOWER(ppd.serial_number) AS serial
      FROM oes_pp_data ppd
      JOIN latest_batch_per_project lb
        ON lb.project = ppd.project AND lb.bid = ppd.import_batch_id
      WHERE ppd.serial_number IS NOT NULL
    )
    SELECT a.activation_date::text AS day,
           ${FILENAME_SITE_SQL} AS site,
           COUNT(*)::int AS n
    FROM oes_activations a
    JOIN oes_import_batches b ON b.id = a.import_batch_id
    WHERE a.activation_date BETWEEN $1::date AND $2::date
      AND a.serial_number IS NOT NULL
      AND LOWER(a.serial_number) IN (SELECT serial FROM current_pp_serials)
    GROUP BY a.activation_date, site
  `, [start, end]);

  const toSiteCount = (
    rows: Array<{ day: string; site: string; n: number }>
  ): DailyCount[] =>
    rows
      .map(r => ({
        day: r.day,
        site: (SITES as readonly string[]).includes(r.site) ? (r.site as SiteCode) : null,
        count: r.n,
      }))
      .filter((r): r is DailyCount => r.site !== null);

  const projectRowsToSiteCount = (
    rows: Array<{ day: string; project: string; n: number }>
  ): DailyCount[] =>
    rows
      .map(r => ({ day: r.day, site: ppProjectToSite(r.project), count: r.n }))
      .filter((r): r is DailyCount => r.site !== null);

  return {
    days,
    sites: [...SITES],
    activations: toSiteCount(activationsRes.rows),
    ppsNew: projectRowsToSiteCount(ppsNewRes.rows),
    ppsOutstanding: projectRowsToSiteCount(ppsOutstandingRes.rows),
    disputes: toSiteCount(disputesRes.rows),
  };
}
