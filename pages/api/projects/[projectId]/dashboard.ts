/**
 * Project Dashboard API
 * GET /api/projects/[projectId]/dashboard
 *
 * Returns aggregated metrics from all modules for a project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.validationError(res, { projectId: 'Project ID is required' });
  }

  try {
    const sql = getSql();

    // Get aggregated data from the dashboard view
    const dashboardData = await sql`
      SELECT
        id, project_code, project_name, status, progress,
        start_date, end_date, client_id, client_name,
        budget, total_budget, committed_amount, budget_actual_amount,
        actual_cost, available_budget, budget_health,
        staff_count, contractor_count, primary_manager_name,
        latest_hs_score, last_audit_date,
        open_tickets, resolved_this_month,
        pending_pos, pending_rfqs, total_po_value
      FROM v_project_dashboard
      WHERE id = ${projectId}
    `;

    if (!dashboardData || dashboardData.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const project = dashboardData[0];

    // Format response with clear categories
    const response = {
      project: {
        id: project.id,
        code: project.project_code,
        name: project.project_name,
        status: project.status,
        progress: project.progress || 0,
        startDate: project.start_date,
        endDate: project.end_date,
        clientId: project.client_id,
        clientName: project.client_name,
      },
      budget: {
        total: Number(project.total_budget) || Number(project.budget) || 0,
        committed: Number(project.committed_amount) || 0,
        actual: Number(project.budget_actual_amount) || Number(project.actual_cost) || 0,
        available: Number(project.available_budget) || 0,
        health: project.budget_health || 'unknown',
      },
      team: {
        staffCount: Number(project.staff_count) || 0,
        contractorCount: Number(project.contractor_count) || 0,
        primaryManager: project.primary_manager_name || null,
      },
      hs: {
        latestScore: project.latest_hs_score ? Number(project.latest_hs_score) : null,
        lastAuditDate: project.last_audit_date || null,
        complianceStatus: project.latest_hs_score
          ? project.latest_hs_score >= 80 ? 'compliant' : 'non-compliant'
          : 'unknown',
      },
      maintenance: {
        openTickets: Number(project.open_tickets) || 0,
        resolvedThisMonth: Number(project.resolved_this_month) || 0,
      },
      procurement: {
        pendingPOs: Number(project.pending_pos) || 0,
        pendingRFQs: Number(project.pending_rfqs) || 0,
        totalPoValue: Number(project.total_po_value) || 0,
      },
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('Error fetching project dashboard', { error, projectId });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);
