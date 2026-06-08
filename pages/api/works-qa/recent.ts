import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';
import { rollupRecent, type RecentFeedRow } from '@/modules/works-qa/utils/recent-rollup';
import type {
  RecentDiscipline,
  RecentSubmissionsResponse,
} from '@/modules/works-qa/types/works-qa.types';

// Recent-submissions feed for the Works QA overview.
//
// QA is phased by discipline (civil → dome → main_joint), and those photo sets
// arrive weeks apart, so the feed is keyed on (pole × discipline), not per pole.
// Per-discipline recency comes from qfield_photo_validations.validated_at: the
// pole_qa_photos slot columns store the photo_key, so we join those keys back to
// the upstream validation rows (the sync already resolved dome-label → pole, so
// no label parsing is needed here).

const DISCIPLINES: readonly RecentDiscipline[] = ['civil', 'dome', 'main_joint'];

const APPROVE_COLUMN: Record<RecentDiscipline, string> = {
  civil: 'civil_approved',
  dome: 'dome_approved',
  main_joint: 'joint_approved',
};

// Column names are sourced from constants (SLOT_META + APPROVE_COLUMN), never user
// input, but we assert the shape before interpolating — mirrors the
// ALLOWED_PHOTO_COLUMNS guard in sync-qfield.ts. Asserting at module load means a
// future unsafe constant fails fast rather than reaching a query string.
const SAFE_COL = /^[a-z0-9_]+$/;

for (const col of Object.values(APPROVE_COLUMN)) {
  if (!SAFE_COL.test(col)) throw new Error(`Unsafe approve column: ${col}`);
}

function columnsFor(d: RecentDiscipline): string[] {
  const cols = SLOT_META.filter(s => s.discipline === d).map(s => s.dbColumn);
  for (const c of cols) {
    if (!SAFE_COL.test(c)) throw new Error(`Unsafe slot column: ${c}`);
  }
  return cols;
}

function buildDisciplineSelect(d: RecentDiscipline): string {
  const cols = columnsFor(d);
  const allPresent = cols.map(c => `pqp.${c} IS NOT NULL`).join(' AND ');
  const anyPresent = cols.map(c => `pqp.${c} IS NOT NULL`).join(' OR ');
  const tray = d === 'main_joint'
    ? ` AND COALESCE(array_length(pqp.main_joint_tray_keys, 1), 0) > 0`
    : '';
  return `
    SELECT pqp.project_id, pqp.zone_no, pqp.pon_no, '${d}'::text AS discipline,
           ((${allPresent})${tray})           AS complete,
           (${anyPresent})                     AS any_present,
           (pqp.${APPROVE_COLUMN[d]} IS TRUE)  AS approved,
           r.last_at
    FROM pole_qa_photos pqp
    LEFT JOIN recency r ON r.id = pqp.id AND r.discipline = '${d}'`;
}

function buildQuery(hasProject: boolean): string {
  const lateralValues = DISCIPLINES
    .flatMap(d => columnsFor(d).map(c => `(pqp.${c}, '${d}')`))
    .join(',\n        ');
  const discCte = DISCIPLINES.map(buildDisciplineSelect).join('\n    UNION ALL\n');
  const projectFilter = hasProject ? 'AND d.project_id = $2::uuid' : '';

  return `
    WITH recency AS (
      SELECT pqp.id, k.discipline, MAX(q.validated_at) AS last_at
      FROM pole_qa_photos pqp
      CROSS JOIN LATERAL (VALUES
        ${lateralValues}
      ) AS k(photo_key, discipline)
      JOIN qfield_photo_validations q ON q.photo_key = k.photo_key
      WHERE k.photo_key IS NOT NULL
      GROUP BY pqp.id, k.discipline
    ),
    disc AS (${discCte}
    )
    SELECT p.id AS project_id, p.project_name, d.zone_no, d.pon_no, d.discipline,
      COUNT(*) FILTER (WHERE d.complete AND NOT d.approved AND d.last_at >= $1)::int
        AS ready_count,
      COUNT(*) FILTER (WHERE d.any_present AND NOT d.complete AND NOT d.approved AND d.last_at >= $1)::int
        AS partial_count,
      MAX(d.last_at) FILTER (WHERE d.complete AND NOT d.approved AND d.last_at >= $1)
        AS latest_ready_at,
      MAX(d.last_at) FILTER (WHERE d.any_present AND NOT d.complete AND NOT d.approved AND d.last_at >= $1)
        AS latest_partial_at
    FROM disc d
    JOIN projects p ON p.id = d.project_id
    WHERE d.last_at IS NOT NULL ${projectFilter}
    GROUP BY p.id, p.project_name, d.zone_no, d.pon_no, d.discipline
    HAVING COUNT(*) FILTER (
      WHERE NOT d.approved AND d.last_at >= $1 AND (d.complete OR d.any_present)
    ) > 0
    ORDER BY p.project_name, d.zone_no NULLS LAST, d.pon_no`;
}

// 30-minute session debounce: a refresh keeps the same "since I last opened"
// cutoff; only a genuinely new visit rolls it forward to when the user was last
// active. First-ever visit starts the window 7 days back so it isn't empty.
async function resolveSinceLastCutoff(email: string): Promise<string> {
  const { rows } = await pool.query<{ cutoff_at: string }>(
    `INSERT INTO works_qa_view_watermark (user_email, cutoff_at, last_active_at)
     VALUES ($1, NOW() - INTERVAL '7 days', NOW())
     ON CONFLICT (user_email) DO UPDATE SET
       cutoff_at = CASE
         WHEN NOW() - works_qa_view_watermark.last_active_at > INTERVAL '30 minutes'
           THEN works_qa_view_watermark.last_active_at
         ELSE works_qa_view_watermark.cutoff_at
       END,
       last_active_at = NOW(),
       updated_at = NOW()
     RETURNING cutoff_at`,
    [email],
  );
  return rows[0]!.cutoff_at;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const windowParam = req.query.window === '7d' ? '7d'
    : req.query.window === 'since_last' ? 'since_last'
    : '3d';
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;
  const email = (req as AuthenticatedNextApiRequest).user.email;

  try {
    // Resolve the cutoff timestamp and the user's watermark.
    let cutoffAt: string;
    let watermarkAt: string | null = null;
    if (windowParam === 'since_last') {
      cutoffAt = await resolveSinceLastCutoff(email);
      watermarkAt = cutoffAt;
    } else {
      const interval = windowParam === '7d' ? '7 days' : '3 days';
      const cut = await pool.query<{ cutoff_at: string }>(
        `SELECT NOW() - $1::interval AS cutoff_at`, [interval],
      );
      cutoffAt = cut.rows[0]!.cutoff_at;
      // Time-window mode does not advance the watermark, but we return it so the
      // UI can flag PONs newer than the user's last visit as "NEW".
      const wm = await pool.query<{ cutoff_at: string }>(
        `SELECT cutoff_at FROM works_qa_view_watermark WHERE user_email = $1`, [email],
      );
      watermarkAt = wm.rows[0]?.cutoff_at ?? null;
    }

    const params: (string)[] = [cutoffAt];
    if (projectId) params.push(projectId);
    const { rows } = await pool.query<RecentFeedRow>(buildQuery(!!projectId), params);

    const lanes = rollupRecent(rows);
    const nowRes = await pool.query<{ now: string }>(`SELECT NOW() AS now`);

    const payload: RecentSubmissionsResponse = {
      window: windowParam,
      cutoffAt,
      watermarkAt,
      asOf: nowRes.rows[0]!.now,
      lanes,
    };
    return apiResponse.success(res, payload);
  } catch (err) {
    log.error('works-qa/recent', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
