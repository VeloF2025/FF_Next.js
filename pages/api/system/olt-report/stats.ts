/**
 * OLT Report Stats API
 *
 * GET: Return counts by fix_status for OLT mismatch records.
 * Optional query params:
 * - dateFrom/dateTo: ISO date range
 * - status: pending | needs_investigation | fixed | escalated | resolved | all
 * - subStatus: needs_investigation | not_found | empty_serial | rejected
 * - search: DR number or serial search
 * - project: single project name
 * - projects: pipe-delimited project names for multi-select
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

interface Stats {
  pending: number;
  needs_investigation: number;
  fixed: number;
  resolved: number;
  escalated: number;
  empty: number;
  total: number;
}

type QueryParam = string | string[] | undefined;
type SqlParam = string | string[];

function firstParam(value: QueryParam): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function appendStatusFilter(status: string, whereParts: string[]) {
  if (status === 'pending') {
    whereParts.push("r.fix_status = 'pending' AND r.olt_serial IS NOT NULL");
  } else if (status === 'needs_investigation') {
    whereParts.push("(r.fix_status IN ('not_found', 'needs_investigation', 'needs_reinvestigation', 'empty_serial', 'rejected') OR r.olt_serial IS NULL)");
  } else if (status === 'fixed') {
    whereParts.push("r.fix_status = 'fixed'");
  } else if (status === 'escalated') {
    whereParts.push("r.fix_status = 'escalated'");
  } else if (status === 'resolved') {
    whereParts.push("r.fix_status = 'resolved'");
  }
}

function appendSubStatusFilter(subStatus: string | null, whereParts: string[], params: SqlParam[]) {
  const validSubStatuses = ['needs_investigation', 'not_found', 'empty_serial', 'rejected'];
  if (!subStatus || !validSubStatuses.includes(subStatus)) return;

  if (subStatus === 'needs_investigation') {
    whereParts.push("r.fix_status IN ('needs_investigation', 'needs_reinvestigation')");
    return;
  }

  params.push(subStatus);
  whereParts.push(`r.fix_status = $${params.length}`);
}

function buildFilters(query: NextApiRequest['query'], includeStatus: boolean, includeSubStatus: boolean) {
  const params: SqlParam[] = [];
  const whereParts: string[] = [];

  const status = includeStatus ? String(firstParam(query.status) || 'all') : 'all';
  appendStatusFilter(status, whereParts);

  if (includeSubStatus) {
    appendSubStatusFilter(firstParam(query.subStatus), whereParts, params);
  }

  const search = firstParam(query.search)?.trim();
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    whereParts.push(`(r.drop_number ILIKE $${idx} OR r.olt_serial ILIKE $${idx} OR r.wrong_onemap_serial ILIKE $${idx})`);
  }

  const dateFrom = firstParam(query.dateFrom);
  if (dateFrom) {
    params.push(dateFrom);
    whereParts.push(`COALESCE(r.fix_attempted_at, r.created_at) >= $${params.length}::timestamptz`);
  }

  const dateTo = firstParam(query.dateTo);
  if (dateTo) {
    params.push(dateTo);
    whereParts.push(`COALESCE(r.fix_attempted_at, r.created_at) < $${params.length}::timestamptz`);
  }

  const project = firstParam(query.project)?.trim();
  const projectsParam = firstParam(query.projects)?.trim();
  const projects = projectsParam
    ? projectsParam.split('|').map((name) => name.trim()).filter(Boolean)
    : [];

  if (projects.length > 0) {
    params.push(projects);
    whereParts.push(`COALESCE(i.project, p.project_name) = ANY($${params.length}::text[])`);
  } else if (project) {
    params.push(project);
    whereParts.push(`COALESCE(i.project, p.project_name) = $${params.length}`);
  }

  return {
    params,
    whereClause: whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '',
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const baseFilters = buildFilters(req.query, true, false);
    const result = await pool.query(`
      SELECT
        CASE
          WHEN r.fix_status = 'pending' AND r.olt_serial IS NOT NULL THEN 'pending'
          WHEN r.fix_status IN ('not_found', 'needs_investigation', 'needs_reinvestigation', 'empty_serial', 'rejected') OR r.olt_serial IS NULL THEN 'needs_investigation'
          ELSE r.fix_status
        END as category,
        COUNT(DISTINCT r.id)::int as count
      FROM olt_mismatch_records r
      LEFT JOIN olt_report_imports i ON r.import_id = i.id
      LEFT JOIN drops d ON r.drop_number = d.drop_number
      LEFT JOIN projects p ON d.project_id = p.id
      ${baseFilters.whereClause}
      GROUP BY category
    `, baseFilters.params);

    const stats: Stats = {
      pending: 0,
      needs_investigation: 0,
      fixed: 0,
      resolved: 0,
      escalated: 0,
      empty: 0,
      total: 0,
    };

    for (const row of result.rows) {
      const category = row.category?.toLowerCase() || 'pending';
      const count = row.count;

      if (category === 'pending') stats.pending = count;
      else if (category === 'needs_investigation') stats.needs_investigation = count;
      else if (category === 'fixed') stats.fixed = count;
      else if (category === 'resolved') stats.resolved = count;
      else if (category === 'escalated') stats.escalated = count;
      else if (category === 'empty_serial') stats.empty = count;

      stats.total += count;
    }

    const investigateFilters = buildFilters(
      { ...req.query, status: 'needs_investigation' },
      true,
      false,
    );
    const subResult = await pool.query(`
      SELECT
        CASE
          WHEN r.fix_status IN ('needs_investigation', 'needs_reinvestigation') THEN 'cross_dr'
          WHEN r.fix_status = 'not_found' THEN 'not_found'
          ELSE 'other'
        END as sub_category,
        COUNT(DISTINCT r.id)::int as count
      FROM olt_mismatch_records r
      LEFT JOIN olt_report_imports i ON r.import_id = i.id
      LEFT JOIN drops d ON r.drop_number = d.drop_number
      LEFT JOIN projects p ON d.project_id = p.id
      ${investigateFilters.whereClause}
      GROUP BY sub_category
    `, investigateFilters.params);

    const investigateBreakdown: Record<string, number> = { cross_dr: 0, not_found: 0, other: 0 };
    for (const row of subResult.rows) {
      investigateBreakdown[row.sub_category] = row.count;
    }

    const projectFilters = buildFilters(
      { ...req.query, status: 'needs_investigation', project: undefined, projects: undefined },
      true,
      true,
    );
    const projectResult = await pool.query(`
      SELECT COALESCE(i.project, p.project_name) AS project, COUNT(DISTINCT r.id)::int AS count
      FROM olt_mismatch_records r
      LEFT JOIN olt_report_imports i ON r.import_id = i.id
      LEFT JOIN drops d ON r.drop_number = d.drop_number
      LEFT JOIN projects p ON d.project_id = p.id
      ${projectFilters.whereClause}
      GROUP BY COALESCE(i.project, p.project_name)
      HAVING COALESCE(i.project, p.project_name) IS NOT NULL
      ORDER BY count DESC, project ASC
    `, projectFilters.params);

    const projectBreakdown = (projectResult.rows as Array<{ project: string; count: number }>).map((row) => ({
      project: row.project,
      count: row.count,
    }));

    return apiResponse.success(res, { ...stats, investigateBreakdown, projectBreakdown });
  } catch (error) {
    log.error('olt-report-stats', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
