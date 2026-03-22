/**
 * Database query layer for drop records.
 * Handles: paginated list, single-by-id, single-by-drop-number.
 *
 * IMPORTANT: Neon tagged templates do NOT support conditional SQL fragments.
 * All conditional JOIN/WHERE logic uses string concatenation on explicit query branches only.
 * No ${cond ? sql`AND x` : sql``} patterns.
 */

import pool from '@/lib/db';
import { DropsFilters, PaginatedDropsResult, UnifiedDrop } from './types';
import { transformDropRow } from './dropTransformService';

// Only show installation/activation projects — exclude marketing & unknown
const EXCLUDED_PROJECTS = ['Marketing', 'Marketing Activations', 'Unknown'];
const EXCLUDED_PROJECTS_SQL = EXCLUDED_PROJECTS.map((p) => `'${p}'`).join(', ');

/** Builds the WHERE conditions and param list from the shared filter shape. */
function buildWhereConditions(filters?: DropsFilters): {
  conditions: string[];
  params: unknown[];
  paramIndex: number;
} {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Base filters always applied to the paginated list
  conditions.push('(u.is_oes_only = FALSE OR u.is_oes_only IS NULL)');
  conditions.push('u.drop_number IN (SELECT drop_number FROM drops)');
  conditions.push(`COALESCE(u.project, '') NOT IN (${EXCLUDED_PROJECTS_SQL})`);

  if (filters?.search) {
    conditions.push(`(u.drop_number ILIKE $${paramIndex} OR u.project ILIKE $${paramIndex})`);
    params.push(`%${filters.search}%`);
    paramIndex++;
  }

  if (filters?.dateFrom) {
    conditions.push(`COALESCE(u.submitted_date, u.created_at::DATE) >= $${paramIndex}::DATE`);
    params.push(filters.dateFrom);
    paramIndex++;
  }

  if (filters?.dateTo) {
    conditions.push(`COALESCE(u.submitted_date, u.created_at::DATE) <= $${paramIndex}::DATE`);
    params.push(filters.dateTo);
    paramIndex++;
  }

  if (filters?.project && filters.project !== 'all') {
    conditions.push(`u.project = $${paramIndex}`);
    params.push(filters.project);
    paramIndex++;
  }

  // Status filters — explicit branches, no conditional SQL fragments
  if (filters?.status === 'reviewed') {
    conditions.push('u.feedback_sent = true');
  } else if (filters?.status === 'not_reviewed' || filters?.status === 'notReviewed') {
    conditions.push('(u.feedback_sent IS NULL OR u.feedback_sent = false)');
  } else if (filters?.status === 'activated') {
    conditions.push('oes.drop_number IS NOT NULL');
  } else if (filters?.status === 'installed') {
    conditions.push('oes.drop_number IS NULL');
  }

  // QA decision filter
  if (filters?.qaStatus === 'pending') {
    conditions.push('(u.qa_decision IS NULL)');
  } else if (filters?.qaStatus === 'passed') {
    conditions.push("u.qa_decision = 'PASS'");
  } else if (filters?.qaStatus === 'failed') {
    conditions.push("u.qa_decision = 'FAIL'");
  } else if (filters?.qaStatus === 'rework') {
    conditions.push("u.qa_decision = 'REWORK_NEEDED'");
  }

  // Serial number status filter
  if (filters?.serialStatus === 'valid') {
    conditions.push(`(
      u.ont_serial_scanned IS NOT NULL
      AND u.ups_serial_scanned IS NOT NULL
      AND (u.ont_serial_scanned LIKE 'ALCL%' OR u.ont_serial_scanned LIKE 'ALCB%')
      AND u.ups_serial_scanned LIKE 'GU18W%'
    )`);
  } else if (filters?.serialStatus === 'swapped') {
    conditions.push(`(
      (u.ont_serial_scanned LIKE 'GU18W%')
      OR (u.ups_serial_scanned LIKE 'ALCL%' OR u.ups_serial_scanned LIKE 'ALCB%')
    )`);
  } else if (filters?.serialStatus === 'missing') {
    conditions.push('(u.ont_serial_scanned IS NULL OR u.ups_serial_scanned IS NULL)');
  } else if (filters?.serialStatus === 'invalid') {
    conditions.push(`(
      (u.ont_serial_scanned IS NOT NULL AND u.ont_serial_scanned NOT LIKE 'ALCL%' AND u.ont_serial_scanned NOT LIKE 'ALCB%' AND u.ont_serial_scanned NOT LIKE 'GU18W%')
      OR (u.ups_serial_scanned IS NOT NULL AND u.ups_serial_scanned NOT LIKE 'GU18W%' AND u.ups_serial_scanned NOT LIKE 'ALCL%' AND u.ups_serial_scanned NOT LIKE 'ALCB%')
    )`);
  }

  if (filters?.resubmissionsOnly) {
    conditions.push('u.submission_count > 1');
  }

  // Review source filter
  if (filters?.reviewSource === 'ai_pending') {
    conditions.push('u.auto_qa_processed = true AND (u.feedback_sent IS NULL OR u.feedback_sent = false)');
  } else if (filters?.reviewSource === 'ai_reviewed') {
    conditions.push('u.auto_qa_processed = true');
  } else if (filters?.reviewSource === 'human_reviewed') {
    conditions.push("u.human_review_status = 'completed'");
  } else if (filters?.reviewSource === 'not_reviewed') {
    conditions.push('u.auto_qa_processed = false AND (u.qa_decision IS NULL)');
  }

  return { conditions, params, paramIndex };
}

/**
 * OPTIMIZED: Get paginated drops with CTE-based query.
 * Count query uses explicit JOIN branch for activated/installed status filters.
 */
export async function getPaginatedDrops(
  page: number,
  pageSize: number,
  filters?: DropsFilters
): Promise<PaginatedDropsResult> {
  const offset = (page - 1) * pageSize;
  const { conditions, params, paramIndex } = buildWhereConditions(filters);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Explicit join branches — avoids conditional SQL fragment (Neon constraint)
  const needsOesJoin = filters?.status === 'activated' || filters?.status === 'installed';
  const countOesJoin = needsOesJoin
    ? 'LEFT JOIN oes_activations oes ON oes.drop_number = u.drop_number'
    : '';

  const countQuery = `
    SELECT COUNT(*)
    FROM dr_photo_unified_reviews u
    ${countOesJoin}
    ${whereClause}
  `;

  const dataQuery = `
    WITH drop_projects AS (
      SELECT d.drop_number, p.project_name
      FROM drops d
      JOIN projects p ON p.id = d.project_id
    ),
    wa_phones AS (
      SELECT DISTINCT ON (drop_number) drop_number, sender_phone
      FROM wa_monitor_drops
      WHERE sender_phone IS NOT NULL
      ORDER BY drop_number, created_at DESC
    ),
    maintenance_refs AS (
      SELECT DISTINCT ON (dr_number) dr_number, id, ticket_uid
      FROM maintenance_tickets
      ORDER BY dr_number, created_at DESC
    )
    SELECT u.*,
      COALESCE(u.project, dp.project_name) as project,
      COALESCE(u.sender_phone, wp.sender_phone) as sender_phone,
      u.qa_phase,
      u.qa_decision,
      u.auto_qa_processed,
      u.auto_qa_processed_at,
      u.submission_count,
      COALESCE(u.submission_count, 1) > 1 as is_resubmission,
      (u.submission_history->0->>'photo_count')::int as previous_photo_count,
      oes.activation_date as oes_activation_date,
      oes.imported_at as oes_imported_at,
      (oes.drop_number IS NOT NULL) as is_activated,
      (mt.id IS NOT NULL) as has_maintenance_ticket,
      mt.ticket_uid as maintenance_ticket_uid
    FROM dr_photo_unified_reviews u
    LEFT JOIN drop_projects dp ON dp.drop_number = u.drop_number
    LEFT JOIN wa_phones wp ON wp.drop_number = u.drop_number
    LEFT JOIN oes_activations oes ON oes.drop_number = u.drop_number
    LEFT JOIN maintenance_refs mt ON mt.dr_number = u.drop_number
    ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const dataParams = [...params, pageSize, offset];

  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(dataQuery, dataParams),
  ]);

  const totalCount = parseInt(countResult.rows[0].count, 10);
  const drops = dataResult.rows.map((row: Record<string, unknown>) => transformDropRow(row));

  return {
    drops,
    pagination: {
      currentPage: page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      hasNextPage: page * pageSize < totalCount,
      hasPreviousPage: page > 1,
    },
  };
}

/** Fetch a single drop by its UUID primary key. Returns null if not found. */
export async function getDropById(id: string): Promise<UnifiedDrop | null> {
  const result = await pool.query(
    `SELECT u.*,
      u.qa_phase,
      u.qa_decision,
      u.submission_count,
      COALESCE(u.submission_count, 1) > 1 as is_resubmission,
      (u.submission_history->0->>'photo_count')::int as previous_photo_count,
      oes.activation_date as oes_activation_date,
      oes.imported_at as oes_imported_at,
      (oes.drop_number IS NOT NULL) as is_activated,
      (mt.id IS NOT NULL) as has_maintenance_ticket,
      mt.ticket_uid as maintenance_ticket_uid
    FROM dr_photo_unified_reviews u
    LEFT JOIN oes_activations oes ON oes.drop_number = u.drop_number
    LEFT JOIN LATERAL (
      SELECT id, ticket_uid FROM maintenance_tickets
      WHERE dr_number = u.drop_number
      ORDER BY created_at DESC LIMIT 1
    ) mt ON true
    WHERE u.id = $1`,
    [id]
  );

  if (result.rows.length === 0) return null;
  return transformDropRow(result.rows[0] as Record<string, unknown>);
}

/** Fetch a single drop by its human-readable drop number. Returns null if not found. */
export async function getDropByDropNumber(dropNumber: string): Promise<UnifiedDrop | null> {
  const result = await pool.query(
    `SELECT u.*,
      u.qa_phase,
      u.qa_decision,
      u.submission_count,
      COALESCE(u.submission_count, 1) > 1 as is_resubmission,
      (u.submission_history->0->>'photo_count')::int as previous_photo_count,
      oes.activation_date as oes_activation_date,
      oes.imported_at as oes_imported_at,
      (oes.drop_number IS NOT NULL) as is_activated,
      (mt.id IS NOT NULL) as has_maintenance_ticket,
      mt.ticket_uid as maintenance_ticket_uid
    FROM dr_photo_unified_reviews u
    LEFT JOIN oes_activations oes ON oes.drop_number = u.drop_number
    LEFT JOIN LATERAL (
      SELECT id, ticket_uid FROM maintenance_tickets
      WHERE dr_number = u.drop_number
      ORDER BY created_at DESC LIMIT 1
    ) mt ON true
    WHERE u.drop_number = $1`,
    [dropNumber]
  );

  if (result.rows.length === 0) return null;
  return transformDropRow(result.rows[0] as Record<string, unknown>);
}

/** Returns distinct project names from both unified reviews and projects tables. */
export async function getActiveProjects(): Promise<string[]> {
  const result = await pool.query(`
    SELECT DISTINCT project_name
    FROM (
      SELECT DISTINCT project as project_name
      FROM dr_photo_unified_reviews
      WHERE project IS NOT NULL AND project != ''
        AND project NOT IN (${EXCLUDED_PROJECTS_SQL})

      UNION

      SELECT project_name
      FROM projects
      WHERE project_name IS NOT NULL AND project_name != ''
        AND project_name NOT IN (${EXCLUDED_PROJECTS_SQL})
    ) combined
    ORDER BY project_name
  `);

  return result.rows.map((row: Record<string, unknown>) => row.project_name as string);
}
