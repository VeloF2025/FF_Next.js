/**
 * EXFO Test Results API
 *
 * GET /api/exfo/results — List synced test results with filters
 *   ?projectId=xxx&testType=olts&verdict=Pass&search=xxx
 *   &page=1&pageSize=50&workspaceId=xxx&assetId=xxx
 *
 * GET /api/exfo/results?action=stats — Aggregate stats
 * GET /api/exfo/results?action=equipment — Equipment summary
 * GET /api/exfo/results?action=projects — Projects with result counts
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  try {
    const action = req.query.action as string || '';

    if (action === 'stats') return handleStats(req, res);
    if (action === 'equipment') return handleEquipment(req, res);
    if (action === 'projects') return handleProjects(res);

    return handleList(req, res);
  } catch (err) {
    log.error('exfo-results', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

async function handleList(req: NextApiRequest, res: NextApiResponse) {
  const projectId = (req.query.projectId as string) || null;
  const testType = (req.query.testType as string) || null;
  const verdict = (req.query.verdict as string) || null;
  const search = (req.query.search as string) || null;
  const workspaceId = (req.query.workspaceId as string) || null;
  const assetId = (req.query.assetId as string) || null;
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string || '50', 10)));
  const offset = (page - 1) * pageSize;
  const searchPattern = search ? `%${search}%` : null;

  // Use null-check pattern: (${val} IS NULL OR column = ${val})
  // When val is null, IS NULL is TRUE so the clause is skipped (no filter)
  // When val has a value, IS NULL is FALSE so the equality check runs
  const rows = await sql`
    SELECT
      r.id, r.exfo_result_id, r.exfo_workspace_id,
      r.test_type, r.test_name, r.job_name,
      r.global_verdict, r.test_date_time, r.server_updated_date,
      r.parsed_project, r.parsed_pole, r.parsed_cabinet,
      r.parsed_port, r.parsed_link, r.parsed_fiber,
      r.unit_a_serial, r.unit_a_model,
      r.unit_b_serial, r.unit_b_model,
      r.platform_serial, r.platform_model,
      r.company_name, r.customer_name, r.operator_a,
      r.cable_id, r.fiber_id, r.location_a, r.location_b,
      r.project_id, r.asset_id, r.attachments_count,
      r.synced_at, r.created_at,
      p.project_name,
      a.name AS asset_name
    FROM exfo_test_results r
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN assets a ON a.id = r.asset_id
    WHERE (${projectId}::UUID IS NULL OR r.project_id = ${projectId}::UUID)
      AND (${testType}::TEXT IS NULL OR r.test_type = ${testType})
      AND (${verdict}::TEXT IS NULL OR r.global_verdict = ${verdict})
      AND (${workspaceId}::TEXT IS NULL OR r.exfo_workspace_id = ${workspaceId})
      AND (${assetId}::UUID IS NULL OR r.asset_id = ${assetId}::UUID)
      AND (${searchPattern}::TEXT IS NULL OR (
        r.test_name ILIKE ${searchPattern}
        OR r.job_name ILIKE ${searchPattern}
        OR r.cable_id ILIKE ${searchPattern}
        OR r.operator_a ILIKE ${searchPattern}
        OR r.unit_a_serial ILIKE ${searchPattern}
      ))
    ORDER BY r.test_date_time DESC NULLS LAST
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const countRows = await sql`
    SELECT COUNT(*) as total FROM exfo_test_results r
    WHERE (${projectId}::UUID IS NULL OR r.project_id = ${projectId}::UUID)
      AND (${testType}::TEXT IS NULL OR r.test_type = ${testType})
      AND (${verdict}::TEXT IS NULL OR r.global_verdict = ${verdict})
      AND (${workspaceId}::TEXT IS NULL OR r.exfo_workspace_id = ${workspaceId})
      AND (${assetId}::UUID IS NULL OR r.asset_id = ${assetId}::UUID)
      AND (${searchPattern}::TEXT IS NULL OR (
        r.test_name ILIKE ${searchPattern}
        OR r.job_name ILIKE ${searchPattern}
        OR r.cable_id ILIKE ${searchPattern}
        OR r.operator_a ILIKE ${searchPattern}
        OR r.unit_a_serial ILIKE ${searchPattern}
      ))
  `;

  return apiResponse.success(res, {
    results: rows,
    total: Number(countRows[0]?.total || 0),
    page,
    pageSize,
  });
}

async function handleStats(req: NextApiRequest, res: NextApiResponse) {
  const projectId = (req.query.projectId as string) || null;

  const stats = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE global_verdict = 'Pass') as passed,
      COUNT(*) FILTER (WHERE global_verdict = 'Fail') as failed,
      COUNT(*) FILTER (WHERE global_verdict IS NULL OR global_verdict NOT IN ('Pass', 'Fail')) as pending,
      COUNT(*) FILTER (WHERE test_type = 'olts') as olts_count,
      COUNT(*) FILTER (WHERE test_type = 'iolm') as iolm_count,
      COUNT(DISTINCT unit_a_serial) FILTER (WHERE unit_a_serial IS NOT NULL) as unique_equipment,
      COUNT(DISTINCT operator_a) FILTER (WHERE operator_a IS NOT NULL) as unique_operators,
      MIN(test_date_time) as earliest_test,
      MAX(test_date_time) as latest_test
    FROM exfo_test_results
    WHERE (${projectId}::UUID IS NULL OR project_id = ${projectId}::UUID)
  `;

  return apiResponse.success(res, stats[0] || {});
}

async function handleEquipment(req: NextApiRequest, res: NextApiResponse) {
  const projectId = (req.query.projectId as string) || null;

  const equipment = await sql`
    SELECT
      unit_a_serial as serial_number,
      unit_a_model as model,
      COUNT(*) as test_count,
      COUNT(*) FILTER (WHERE global_verdict = 'Pass') as pass_count,
      COUNT(*) FILTER (WHERE global_verdict = 'Fail') as fail_count,
      MIN(test_date_time) as first_test,
      MAX(test_date_time) as last_test,
      r.asset_id,
      a.name AS asset_name
    FROM exfo_test_results r
    LEFT JOIN assets a ON a.id = r.asset_id
    WHERE unit_a_serial IS NOT NULL
      AND (${projectId}::UUID IS NULL OR r.project_id = ${projectId}::UUID)
    GROUP BY unit_a_serial, unit_a_model, r.asset_id, a.name
    ORDER BY test_count DESC
  `;

  return apiResponse.success(res, { equipment });
}

async function handleProjects(res: NextApiResponse) {
  const projects = await sql`
    SELECT DISTINCT
      r.parsed_project as code,
      p.id as project_id,
      p.project_name,
      COUNT(*) as result_count
    FROM exfo_test_results r
    LEFT JOIN projects p ON p.id = r.project_id
    GROUP BY r.parsed_project, p.id, p.project_name
    ORDER BY result_count DESC
  `;

  return apiResponse.success(res, { projects });
}

export default withAuth(handler);
