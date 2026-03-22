/**
 * Per-project aggregation queries for the drops API.
 * Overall summary counts live in dropStatsService.ts.
 *
 * IMPORTANT: Neon tagged templates do NOT support conditional SQL fragments.
 * All conditional conditions are assembled as plain strings and interpolated
 * into explicit query strings — never as ternary template literals.
 */

import pool from '@/lib/db';
import { DropsFilters, ProjectStats } from './types';
import { buildUnifiedConditions } from './dropStatsService';

const EXCLUDED_PROJECTS = ['Marketing', 'Marketing Activations', 'Unknown'];
const EXCLUDED_PROJECTS_SQL = EXCLUDED_PROJECTS.map((p) => `'${p}'`).join(', ');

/**
 * OPTIMIZED: Get per-project stats via parallel queries on unified reviews + OES.
 * Returns sorted descending by total drops; applies status filter shaping.
 */
export async function getProjectStats(filters?: DropsFilters): Promise<ProjectStats[]> {
  const unifiedCond = buildUnifiedConditions(filters, 'submitted_date', 'project');

  const activatedParams: unknown[] = [
    filters?.dateFrom ?? '1900-01-01',
    filters?.dateTo ?? '2100-01-01',
  ];
  let activatedNextParam = 3;
  let activatedProjectCond = '';
  let activatedSearchCond = '';

  if (filters?.project && filters.project !== 'all') {
    activatedProjectCond = `AND (upr.project = $${activatedNextParam} OR p.project_name = $${activatedNextParam} OR (upr.project IS NULL AND p.project_name IS NULL))`;
    activatedParams.push(filters.project);
    activatedNextParam++;
  }
  if (filters?.search) {
    activatedSearchCond = `AND (oes.drop_number ILIKE $${activatedNextParam} OR COALESCE(upr.project, p.project_name) ILIKE $${activatedNextParam})`;
    activatedParams.push(`%${filters.search}%`);
    activatedNextParam++;
  }

  // Inner project condition reuses same param position as activatedParams
  const oesOnlyProjectCond =
    filters?.project && filters.project !== 'all'
      ? `AND upr2.project = $${activatedParams.indexOf(filters.project) + 1}`
      : '';

  const installedQuery = `
    SELECT
      COALESCE(project, 'Unknown') as project,
      COUNT(*) as installed,
      COUNT(*) FILTER (WHERE feedback_sent = true) as reviewed
    FROM dr_photo_unified_reviews
    ${unifiedCond.whereClause}${unifiedCond.whereClause ? ' AND' : ' WHERE'} (is_oes_only = FALSE OR is_oes_only IS NULL)
      AND drop_number IN (SELECT drop_number FROM drops)
      AND COALESCE(project, '') NOT IN (${EXCLUDED_PROJECTS_SQL})
    GROUP BY COALESCE(project, 'Unknown')
  `;

  const activatedQuery = `
    SELECT
      COALESCE(upr.project, p.project_name, 'Unknown') as project,
      COUNT(DISTINCT oes.drop_number) as activated
    FROM oes_activations oes
    LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
    LEFT JOIN drops d ON d.drop_number = oes.drop_number
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE oes.activation_date >= $1::DATE
      AND oes.activation_date <= $2::DATE
      ${activatedProjectCond}
      ${activatedSearchCond}
    GROUP BY COALESCE(upr.project, p.project_name, 'Unknown')
  `;

  const oesOnlyQuery = `
    SELECT
      COALESCE(upr.project, p.project_name, 'Unknown') as project,
      COUNT(DISTINCT oes.drop_number) as oes_only
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
          ${oesOnlyProjectCond}
      )
      ${activatedProjectCond}
      ${activatedSearchCond}
    GROUP BY COALESCE(upr.project, p.project_name, 'Unknown')
  `;

  const [installedResult, activatedResult, oesOnlyResult] = await Promise.all([
    pool.query(installedQuery, unifiedCond.params),
    pool.query(activatedQuery, activatedParams),
    pool.query(oesOnlyQuery, activatedParams),
  ]);

  const projectMap = new Map<string, ProjectStats>();

  for (const row of installedResult.rows) {
    const installed = parseInt(row.installed, 10);
    const reviewed = parseInt(row.reviewed, 10);
    projectMap.set(row.project, {
      project: row.project,
      total: installed,
      installed,
      activated: 0,
      reviewed,
      notReviewed: installed - reviewed,
    });
  }

  for (const row of activatedResult.rows) {
    const existing = projectMap.get(row.project);
    if (existing) {
      existing.activated = parseInt(row.activated, 10);
    } else {
      projectMap.set(row.project, {
        project: row.project,
        total: 0,
        installed: 0,
        activated: parseInt(row.activated, 10),
        reviewed: 0,
        notReviewed: 0,
      });
    }
  }

  for (const row of oesOnlyResult.rows) {
    const oesOnly = parseInt(row.oes_only, 10);
    const existing = projectMap.get(row.project);
    if (existing) {
      existing.total += oesOnly;
    } else {
      projectMap.set(row.project, {
        project: row.project,
        total: oesOnly,
        installed: 0,
        activated: oesOnly,
        reviewed: 0,
        notReviewed: 0,
      });
    }
  }

  const stats = Array.from(projectMap.values());

  if (filters?.status === 'reviewed') {
    return stats
      .filter((s) => s.reviewed > 0)
      .map((s) => ({ ...s, total: s.reviewed, notReviewed: 0 }))
      .sort((a, b) => b.total - a.total);
  }

  if (filters?.status === 'notReviewed') {
    return stats
      .filter((s) => s.notReviewed > 0)
      .map((s) => ({ ...s, total: s.notReviewed, reviewed: 0 }))
      .sort((a, b) => b.total - a.total);
  }

  return stats.sort((a, b) => b.total - a.total);
}
