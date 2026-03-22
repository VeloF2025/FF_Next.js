/**
 * Summary aggregation queries for the drops API.
 * Per-project stats live in dropProjectStatsService.ts.
 *
 * IMPORTANT: Neon tagged templates do NOT support conditional SQL fragments.
 * Conditional JOIN/WHERE conditions are assembled via string variables then
 * interpolated into explicit query strings — never as ternary template literals.
 */

import pool from '@/lib/db';
import { DropsFilters, Summary } from './types';

const EXCLUDED_PROJECTS = ['Marketing', 'Marketing Activations', 'Unknown'];
const EXCLUDED_PROJECTS_SQL = EXCLUDED_PROJECTS.map((p) => `'${p}'`).join(', ');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export interface ConditionResult {
  conditions: string[];
  params: unknown[];
  whereClause: string;
}

/**
 * Builds WHERE conditions for the unified reviews table.
 * dateCol / projectCol / dropNumberCol are column expressions (not user input).
 * Exported for reuse in dropProjectStatsService.
 */
export function buildUnifiedConditions(
  filters: DropsFilters | undefined,
  dateCol: string,
  projectCol: string,
  dropNumberCol = 'drop_number'
): ConditionResult {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters?.dateFrom) {
    conditions.push(`${dateCol} >= $${paramIndex}::DATE`);
    params.push(filters.dateFrom);
    paramIndex++;
  }
  if (filters?.dateTo) {
    conditions.push(`${dateCol} <= $${paramIndex}::DATE`);
    params.push(filters.dateTo);
    paramIndex++;
  }
  if (filters?.project && filters.project !== 'all') {
    conditions.push(`${projectCol} = $${paramIndex}`);
    params.push(filters.project);
    paramIndex++;
  }
  if (filters?.search) {
    conditions.push(
      `(${dropNumberCol} ILIKE $${paramIndex} OR ${projectCol} ILIKE $${paramIndex})`
    );
    params.push(`%${filters.search}%`);
    paramIndex++;
  }

  return {
    conditions,
    params,
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * OPTIMIZED: Calculate overall summary counts with parallel queries.
 * Activated count uses a separate query against oes_activations.
 */
export async function calculateSummary(filters?: DropsFilters): Promise<Summary> {
  const unifiedCond = buildUnifiedConditions(
    filters,
    'COALESCE(submitted_date, created_at::DATE)',
    'project'
  );

  // Build oes_activations params — uses fixed $1/$2 for date range
  const activatedParams: unknown[] = [
    filters?.dateFrom ?? '1900-01-01',
    filters?.dateTo ?? '2100-01-01',
  ];
  let sumNextParam = 3;
  let sumProjectCond = '';
  let sumSearchCond = '';

  if (filters?.project && filters.project !== 'all') {
    sumProjectCond = `AND (upr.project = $${sumNextParam} OR p.project_name = $${sumNextParam})`;
    activatedParams.push(filters.project);
    sumNextParam++;
  }
  if (filters?.search) {
    sumSearchCond = `AND (oes.drop_number ILIKE $${sumNextParam} OR COALESCE(upr.project, p.project_name) ILIKE $${sumNextParam})`;
    activatedParams.push(`%${filters.search}%`);
    sumNextParam++;
  }

  // oesOnly inner filter uses the project at same position as activatedParams
  const sumOesProjectCond =
    filters?.project && filters.project !== 'all'
      ? `AND upr2.project = $${activatedParams.indexOf(filters.project) + 1}`
      : '';

  const installedQuery = `
    SELECT
      COUNT(*) as installed,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'approved') as complete,
      COUNT(*) FILTER (WHERE feedback_sent = true) as feedback_sent,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'pending' OR vlm_categorization_status IS NULL) as vlm_pending,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'processing') as vlm_processing,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'categorized' OR vlm_categorization_status = 'approved') as vlm_categorized,
      COUNT(*) FILTER (WHERE vlm_categorization_status = 'failed') as vlm_failed
    FROM dr_photo_unified_reviews
    ${unifiedCond.whereClause}${unifiedCond.whereClause ? ' AND' : ' WHERE'} (is_oes_only = FALSE OR is_oes_only IS NULL)
      AND drop_number IN (SELECT drop_number FROM drops)
      AND COALESCE(project, '') NOT IN (${EXCLUDED_PROJECTS_SQL})
  `;

  const activatedQuery = `
    SELECT COUNT(DISTINCT oes.drop_number) as activated
    FROM oes_activations oes
    LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
    LEFT JOIN drops d ON d.drop_number = oes.drop_number
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE oes.activation_date >= $1::DATE
      AND oes.activation_date <= $2::DATE
      ${sumProjectCond}
      ${sumSearchCond}
  `;

  const oesOnlyQuery = `
    SELECT COUNT(DISTINCT oes.drop_number) as oes_only
    FROM oes_activations oes
    LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
    LEFT JOIN drops d ON d.drop_number = oes.drop_number
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE oes.activation_date >= $1::DATE
      AND oes.activation_date <= $2::DATE
      AND NOT EXISTS (
        SELECT 1 FROM dr_photo_unified_reviews upr2
        WHERE upr2.drop_number = oes.drop_number
          AND COALESCE(upr2.submitted_date, upr2.created_at::DATE) >= $1::DATE
          AND COALESCE(upr2.submitted_date, upr2.created_at::DATE) <= $2::DATE
          ${sumOesProjectCond}
      )
      ${sumProjectCond}
      ${sumSearchCond}
  `;

  const [installedResult, activatedResult, oesOnlyResult] = await Promise.all([
    pool.query(installedQuery, unifiedCond.params),
    pool.query(activatedQuery, activatedParams),
    pool.query(oesOnlyQuery, activatedParams),
  ]);

  const installedRow = installedResult.rows[0];
  const installed = parseInt(installedRow?.installed ?? '0', 10);
  const activated = parseInt(activatedResult.rows[0]?.activated ?? '0', 10);
  const oesOnly = parseInt(oesOnlyResult.rows[0]?.oes_only ?? '0', 10);

  let total = installed + oesOnly;
  let reviewed = parseInt(installedRow?.feedback_sent ?? '0', 10);
  let notReviewed = installed - reviewed;
  const feedbackSent = parseInt(installedRow?.feedback_sent ?? '0', 10);

  if (filters?.status === 'reviewed') {
    total = reviewed;
    notReviewed = 0;
  } else if (filters?.status === 'notReviewed') {
    total = notReviewed;
    reviewed = 0;
  }

  return {
    totalDrops: total,
    installed,
    activated,
    notReviewed:
      filters?.status === 'reviewed'
        ? 0
        : filters?.status === 'notReviewed'
          ? total
          : notReviewed,
    reviewed,
    totalFeedback: feedbackSent,
    feedback_sent: feedbackSent,
    vlm_pending: parseInt(installedRow?.vlm_pending ?? '0', 10),
    vlm_processing: parseInt(installedRow?.vlm_processing ?? '0', 10),
    vlm_categorized: parseInt(installedRow?.vlm_categorized ?? '0', 10),
    vlm_failed: parseInt(installedRow?.vlm_failed ?? '0', 10),
  };
}

