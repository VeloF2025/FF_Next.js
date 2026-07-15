import type { FnoKey } from './fnoReportTypes';

export const FNO_NAMES: Record<FnoKey, string> = {
  fibertime: 'Fibertime',
  herotel: 'Herotel',
};

export const FNO_PATTERNS: Record<FnoKey, string[]> = {
  fibertime: ['%fibertime%', 'FT_%'],
  herotel: ['%herotel%', 'HT_%'],
};

export function buildProjectWhere(fnoKey: FnoKey, projectId?: string): { where: string; params: unknown[] } {
  const [clientPattern, projectPattern] = FNO_PATTERNS[fnoKey];
  const params: unknown[] = [clientPattern, projectPattern];
  let where = `(
    lower(COALESCE(c.company_name, '')) LIKE lower($1)
    OR p.project_code ILIKE $2
    OR p.project_name ILIKE $2
  )`;

  if (projectId) {
    params.push(projectId);
    where += ` AND p.id = $${params.length}::uuid`;
  }

  return { where, params };
}

export function buildFnoHierarchySql(projectWhere: string): string {
  return `
    WITH selected_projects AS (
      SELECT p.id, p.project_name
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE ${projectWhere}
    ),
    normalized_poles AS (
      SELECT
        p.project_id,
        parseIntAlias(COALESCE(p.zone_no::text, p.metadata->>'zone_no', p.metadata->>'zone', p.metadata->>'Zone', p.metadata->>'Phase', p.metadata->>'phase')) AS zone_no,
        parseIntAlias(COALESCE(p.pon_no::text, p.metadata->>'pon_no', p.metadata->>'PON', p.metadata->>'Pond', p.metadata->>'PON No', p.metadata->>'PON Nr', p.metadata->>'pon')) AS pon_no,
        p.pole_planted,
        p.audit_complete,
        p.status
      FROM poles p
      JOIN selected_projects sp ON sp.id = p.project_id
      WHERE COALESCE(p.source, '') = 'qfield'
    ),
    qfield_poles AS (
      SELECT
        project_id,
        zone_no,
        pon_no,
        COUNT(*)::int AS pole_scope,
        COUNT(*) FILTER (
          WHERE COALESCE(pole_planted, '') <> ''
             OR audit_complete IS NOT NULL
             OR lower(COALESCE(status, '')) IN ('planted', 'installed', 'complete', 'completed', 'built', 'asbuilt')
        )::int AS pole_actual
      FROM normalized_poles
      GROUP BY project_id, zone_no, pon_no
    ),
    normalized_cables AS (
      SELECT
        cs.project_id,
        parseIntAlias(COALESCE(cs.zone_no::text, cs.metadata->>'zone_no', cs.metadata->>'zone', cs.metadata->>'Zone')) AS zone_no,
        parseIntAlias(COALESCE(cs.pon_no::text, cs.metadata->>'pon_no', cs.metadata->>'PON', cs.metadata->>'Pond', cs.metadata->>'PON No', cs.metadata->>'PON Nr')) AS pon_no,
        COALESCE(cs.length_meters, 0) AS length_meters,
        cs.status
      FROM cable_spans cs
      JOIN selected_projects sp ON sp.id = cs.project_id
      WHERE COALESCE(cs.source, '') = 'qfield'
    ),
    qfield_cables AS (
      SELECT
        project_id,
        zone_no,
        pon_no,
        SUM(length_meters)::numeric AS cable_scope_meters,
        SUM(CASE
          WHEN lower(COALESCE(status, '')) IN ('installed', 'complete', 'completed', 'built', 'asbuilt', 'as-built')
          THEN length_meters
          ELSE 0
        END)::numeric AS cable_actual_meters
      FROM normalized_cables
      GROUP BY project_id, zone_no, pon_no
    ),
    qfield_stages AS (
      SELECT
        pst.project_id,
        pst.zone_no,
        pst.pon_no,
        SUM(COALESCE(pst.cwc_total, 0))::int AS cwc_total,
        SUM(COALESCE(pst.cwc_complete, 0))::int AS cwc_complete,
        MAX(pst.cwc_last_date)::text AS cwc_last_date,
        SUM(COALESCE(pst.atp_total, 0))::int AS atp_total,
        SUM(COALESCE(pst.atp_passed, 0))::int AS atp_passed,
        MAX(pst.atp_last_date)::text AS atp_last_date
      FROM pon_stage_tracking pst
      JOIN selected_projects sp ON sp.id = pst.project_id
      WHERE COALESCE(pst.sync_source, '') = 'qfield'
      GROUP BY pst.project_id, pst.zone_no, pst.pon_no
    ),
    qa AS (
      SELECT r.project_id, r.zone_no, r.pon_no, SUM(COALESCE(r.photo_count, 0))::int AS qa_photos
      FROM construction_qa_reviews r
      JOIN selected_projects sp ON sp.id = r.project_id
      WHERE r.feature_type = 'pole'
      GROUP BY r.project_id, r.zone_no, r.pon_no
    ),
    keys AS (
      SELECT project_id, zone_no, pon_no FROM qfield_poles
      UNION SELECT project_id, zone_no, pon_no FROM qfield_cables
      UNION SELECT project_id, zone_no, pon_no FROM qfield_stages
      UNION SELECT project_id, zone_no, pon_no FROM qa
    )
    SELECT
      k.project_id::text,
      sp.project_name,
      k.zone_no,
      k.pon_no,
      COALESCE(qp.pole_scope, 0)::int AS pole_scope,
      COALESCE(qp.pole_actual, 0)::int AS pole_actual,
      COALESCE(qc.cable_scope_meters, 0)::numeric AS cable_scope_meters,
      COALESCE(qc.cable_actual_meters, 0)::numeric AS cable_actual_meters,
      COALESCE(qs.cwc_total, 0)::int AS cwc_total,
      COALESCE(qs.cwc_complete, 0)::int AS cwc_complete,
      qs.cwc_last_date,
      COALESCE(qs.atp_total, 0)::int AS atp_total,
      COALESCE(qs.atp_passed, 0)::int AS atp_passed,
      qs.atp_last_date,
      COALESCE(qa.qa_photos, 0)::int AS qa_photos
    FROM keys k
    JOIN selected_projects sp ON sp.id = k.project_id
    LEFT JOIN qfield_poles qp ON qp.project_id = k.project_id AND qp.zone_no IS NOT DISTINCT FROM k.zone_no AND qp.pon_no IS NOT DISTINCT FROM k.pon_no
    LEFT JOIN qfield_cables qc ON qc.project_id = k.project_id AND qc.zone_no IS NOT DISTINCT FROM k.zone_no AND qc.pon_no IS NOT DISTINCT FROM k.pon_no
    LEFT JOIN qfield_stages qs ON qs.project_id = k.project_id AND qs.zone_no IS NOT DISTINCT FROM k.zone_no AND qs.pon_no IS NOT DISTINCT FROM k.pon_no
    LEFT JOIN qa ON qa.project_id = k.project_id AND qa.zone_no IS NOT DISTINCT FROM k.zone_no AND qa.pon_no IS NOT DISTINCT FROM k.pon_no
    ORDER BY sp.project_name, k.zone_no NULLS LAST, k.pon_no NULLS LAST
  `;
}

function parseIntAlias(expression: string): string {
  return `CASE WHEN regexp_replace(${expression}, '[^0-9]', '', 'g') <> '' THEN regexp_replace(${expression}, '[^0-9]', '', 'g')::int ELSE NULL END`;
}
