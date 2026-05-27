import { pool } from '@/lib/db';
import { SITES, ppProjectToSite, type SiteCode } from './queries';

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

// Site code is derived from the import batch filename — Fibertime SP-synced
// files follow 'oes_status_report_<SITE>_YYYYMMDD.xlsx', so the site code sits
// at split_part position 4. Etwatwa is published per-POP ('ETW-1','ETW-2',…)
// but aggregates to a single 'ETW' site, so any 'ETW*' filename code maps to ETW.
// Manually-uploaded consolidated files (e.g. the "VELOCITY OES REPORT …" sheets)
// don't carry per-site info in the filename, so we fall back to the team-name
// prefix on the activation row itself:
// 'law20' → LAW, 'mam2' → MAM, 'moa1' → MOA, 'tem5' → TEM, 'etw1' → ETW.
//
// TEM-3 (Tembisa POP 3) cannot be split from TEM (POP 1) via team alone —
// both POPs share 'tem*' teams. TEM-3 only appears when the proper per-site
// SP-synced file is present, so it stays zero on consolidated-file fallback.
const SITE_FROM_BATCH_OR_TEAM_SQL = `
  COALESCE(
    CASE
      WHEN split_part(b.filename, '_', 4) IN ('LAW','MAM','MOA','TEM','TEM-3')
           THEN split_part(b.filename, '_', 4)
      WHEN split_part(b.filename, '_', 4) LIKE 'ETW%' THEN 'ETW'
      ELSE NULL
    END,
    CASE UPPER(SUBSTRING(a.team FROM '^([a-zA-Z]+)'))
      WHEN 'LAW' THEN 'LAW'
      WHEN 'MAM' THEN 'MAM'
      WHEN 'MOA' THEN 'MOA'
      WHEN 'TEM' THEN 'TEM'
      WHEN 'ETW' THEN 'ETW'
    END
  )
`;

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

  // LEFT JOIN so rows without a batch link (or with non-conforming filenames)
  // still appear via the team-prefix fallback in SITE_FROM_BATCH_OR_TEAM_SQL.
  const activationsRes = await pool.query<{ day: string; site: string | null; n: number }>(`
    SELECT a.activation_date::text AS day,
           ${SITE_FROM_BATCH_OR_TEAM_SQL} AS site,
           COUNT(*)::int AS n
    FROM oes_activations a
    LEFT JOIN oes_import_batches b ON b.id = a.import_batch_id
    WHERE a.activation_date BETWEEN $1::date AND $2::date
    GROUP BY a.activation_date, site
  `, [start, end]);

  // ppsNew is scoped to the latest batch per project so a same-week FT re-publish
  // (which gets a new import_batch_id) doesn't double-count older rows.
  const ppsNewRes = await pool.query<{ day: string; project: string; n: number }>(`
    WITH latest_batch_per_project AS (
      SELECT project, MAX(import_batch_id) AS bid
      FROM oes_pp_data
      WHERE project IS NOT NULL
      GROUP BY project
    )
    SELECT p.date_registered::text AS day, p.project, COUNT(*)::int AS n
    FROM oes_pp_data p
    JOIN latest_batch_per_project lb
      ON p.project = lb.project AND p.import_batch_id = lb.bid
    WHERE p.date_registered BETWEEN $1::date AND $2::date
    GROUP BY p.date_registered, p.project
  `, [start, end]);

  // Outstanding = every row in FT's latest publish at end of day D, all statuses.
  // Forward-fills across non-publish days by picking the latest batch on-or-before D.
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
               WHEN pib.filename LIKE 'oes_status_report_ETW%' THEN 'Etwatwa'
             END AS project
      FROM oes_pp_import_batches pib
      WHERE pib.filename IS NOT NULL
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

  // Disputes use the CURRENT PP publish (latest batch per project) as the reference
  // set — same snapshot as the FT Dispute tab, so the two stay consistent. As a
  // side-effect, historical day counts shift retroactively when FT updates the list.
  const disputesRes = await pool.query<{ day: string; site: string | null; n: number }>(`
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
           ${SITE_FROM_BATCH_OR_TEAM_SQL} AS site,
           COUNT(*)::int AS n
    FROM oes_activations a
    LEFT JOIN oes_import_batches b ON b.id = a.import_batch_id
    WHERE a.activation_date BETWEEN $1::date AND $2::date
      AND a.serial_number IS NOT NULL
      AND LOWER(a.serial_number) IN (SELECT serial FROM current_pp_serials)
    GROUP BY a.activation_date, site
  `, [start, end]);

  const toSiteCount = (
    rows: Array<{ day: string; site: string | null; n: number }>
  ): DailyCount[] =>
    rows
      .map(r => ({
        day: r.day,
        site: r.site && (SITES as readonly string[]).includes(r.site) ? (r.site as SiteCode) : null,
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
