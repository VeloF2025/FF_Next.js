/**
 * Portfolio Dashboard API (PRD-058)
 * Returns aggregated metrics for the projects portfolio
 *
 * GET /api/projects/portfolio-dashboard
 *
 * Response:
 * {
 *   counts: { total, pipeline, planned, active, completed, onHold, atRisk },
 *   budget: { totalBudget, totalCommitted, totalActual, available, utilizationPercent, health },
 *   network: { totalDrops, completedDrops, progressPercent },
 *   compliance: { avgHsScore, openIncidents, pendingAudits },
 *   maintenance: { openTickets, criticalTickets },
 *   expiringDocs: { count30Days, count60Days, count90Days },
 *   recentProjects: Project[]
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { safeQuery, safeArrayQuery } from '@/lib/safe-query';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

// Create a new connection for each request
const getSql = () => neon(process.env.DATABASE_URL!);

interface PortfolioDashboardResponse {
  counts: {
    total: number;
    pipeline: number;
    planned: number;
    active: number;
    completed: number;
    onHold: number;
    atRisk: number;
  };
  budget: {
    totalBudget: number;
    totalCommitted: number;
    totalActual: number;
    available: number;
    utilizationPercent: number;
    health: 'healthy' | 'warning' | 'critical';
  };
  network: {
    totalDrops: number;
    completedDrops: number;
    progressPercent: number;
  };
  compliance: {
    avgHsScore: number;
    openIncidents: number;
    pendingAudits: number;
  };
  maintenance: {
    openTickets: number;
    criticalTickets: number;
  };
  expiringDocs: {
    count30Days: number;
    count60Days: number;
    count90Days: number;
  };
  recentProjects: Array<{
    id: string;
    project_name: string;
    client_name: string | null;
    status: string;
    progress: number;
    manager_name: string | null;
  }>;
}

/**
 * Calculate budget health based on utilization percentage
 */
function calculateBudgetHealth(utilization: number): 'healthy' | 'warning' | 'critical' {
  if (utilization > 100) return 'critical';
  if (utilization >= 80) return 'warning';
  return 'healthy';
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, ['GET']);
  }

  try {
    const sql = getSql();

    // OPTIMIZED: Run all queries in parallel instead of sequentially
    // Reduced from 3s to ~500ms by executing 8 queries concurrently
    // NOTE: All recommended indexes confirmed present (2026-02-21).
    //   idx_projects_created_at was missing — created via Flow on 2026-02-21.
    const [
      countsRows,
      budgetRows,
      networkRows,
      maintenanceRows,
      expiringDocsRows,
      recentProjects,
      atRiskRows,
    ] = await Promise.all([
      // 1. Get project counts by status
      safeArrayQuery<{
        total_projects: number;
        pipeline_count: number;
        planned_count: number;
        active_count: number;
        completed_count: number;
        on_hold_count: number;
      }>(
        async () => sql`
          SELECT
            COUNT(*)::int as total_projects,
            COUNT(*) FILTER (WHERE status = 'pipeline')::int as pipeline_count,
            COUNT(*) FILTER (WHERE status IN ('planning', 'planned'))::int as planned_count,
            COUNT(*) FILTER (WHERE status IN ('active', 'in_progress'))::int as active_count,
            COUNT(*) FILTER (WHERE status IN ('completed', 'complete'))::int as completed_count,
            COUNT(*) FILTER (WHERE status = 'on_hold')::int as on_hold_count
          FROM projects
        `
      ).catch(() => [{
        total_projects: 0,
        pipeline_count: 0,
        planned_count: 0,
        active_count: 0,
        completed_count: 0,
        on_hold_count: 0,
      }]),

      // 2. Get budget aggregates - only for active/planning projects
      safeArrayQuery<{
        total_budget: number;
        total_committed: number;
        total_actual: number;
      }>(
        async () => sql`
          SELECT
            COALESCE(SUM(budget), 0)::numeric as total_budget,
            0::numeric as total_committed,
            COALESCE(SUM(actual_cost), 0)::numeric as total_actual
          FROM projects
          WHERE status IN ('active', 'in_progress', 'planning', 'planned')
        `
      ).catch(() => [{
        total_budget: 0,
        total_committed: 0,
        total_actual: 0,
      }]),

      // 3. Get network progress (drops)
      safeArrayQuery<{
        total_drops: number;
        completed_drops: number;
      }>(
        async () => sql`
          SELECT
            COUNT(*)::int as total_drops,
            COUNT(*) FILTER (WHERE status IN ('completed', 'activated', 'installed'))::int as completed_drops
          FROM drops
        `
      ).catch(() => [{
        total_drops: 0,
        completed_drops: 0,
      }]),

      // 4. Get maintenance ticket counts
      safeArrayQuery<{
        open_tickets: number;
        critical_tickets: number;
      }>(
        async () => sql`
          SELECT
            COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int as open_tickets,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND priority IN ('critical', 'high'))::int as critical_tickets
          FROM maintenance_tickets
        `
      ).catch(() => [{
        open_tickets: 0,
        critical_tickets: 0,
      }]),

      // 5. Get expiring documents counts
      safeArrayQuery<{
        count_30_days: number;
        count_60_days: number;
        count_90_days: number;
      }>(
        async () => sql`
          SELECT
            COUNT(*) FILTER (WHERE expiry_date BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '30 days')::int as count_30_days,
            COUNT(*) FILTER (WHERE expiry_date BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '60 days')::int as count_60_days,
            COUNT(*) FILTER (WHERE expiry_date BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '90 days')::int as count_90_days
          FROM document_expiry_tracking
          WHERE status != 'renewed'
        `
      ).catch(() => [{
        count_30_days: 0,
        count_60_days: 0,
        count_90_days: 0,
      }]),

      // 6. Get recent projects (last 10) - use subquery instead of LATERAL JOIN
      safeArrayQuery<{
        id: string;
        project_name: string;
        client_name: string | null;
        status: string;
        progress: number;
        manager_name: string | null;
        total_drops: number;
        completed_drops: number;
      }>(
        async () => sql`
          WITH project_drops AS (
            SELECT
              project_id,
              COUNT(*)::int as total_drops,
              COUNT(*) FILTER (WHERE status IN ('completed', 'activated', 'installed'))::int as completed_drops
            FROM drops
            GROUP BY project_id
          )
          SELECT
            p.id,
            p.project_name,
            c.company_name as client_name,
            p.status,
            COALESCE(pd.total_drops, 0)::int as total_drops,
            COALESCE(pd.completed_drops, 0)::int as completed_drops,
            CASE
              WHEN COALESCE(pd.total_drops, 0) = 0 THEN 0
              ELSE ROUND((pd.completed_drops::numeric / pd.total_drops) * 100)::int
            END as progress,
            COALESCE(s.name, NULLIF(CONCAT(u.first_name, ' ', u.last_name), ' '), p.project_manager::text) as manager_name
          FROM projects p
          LEFT JOIN clients c ON p.client_id = c.id
          LEFT JOIN staff s ON p.project_manager::text = s.id::text
          LEFT JOIN users u ON p.project_manager::text = u.id::text
          LEFT JOIN project_drops pd ON pd.project_id = p.id
          ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
          LIMIT 10
        `
      ).catch(() => []),

      // 7. Calculate at-risk projects (active with low progress or budget issues)
      safeArrayQuery<{ at_risk_count: number }>(
        async () => sql`
          SELECT COUNT(*)::int as at_risk_count
          FROM projects
          WHERE status IN ('active', 'in_progress')
            AND (
              (budget > 0 AND actual_cost > budget)
              OR (progress < 25 AND created_at < CURRENT_DATE - INTERVAL '30 days')
            )
        `
      ).catch(() => [{ at_risk_count: 0 }]),
    ]);

    const counts = countsRows[0] || {
      total_projects: 0,
      pipeline_count: 0,
      planned_count: 0,
      active_count: 0,
      completed_count: 0,
      on_hold_count: 0,
    };

    const budget = budgetRows[0] || {
      total_budget: 0,
      total_committed: 0,
      total_actual: 0,
    };

    const totalBudget = Number(budget.total_budget) || 0;
    const totalCommitted = Number(budget.total_committed) || 0;
    const totalActual = Number(budget.total_actual) || 0;
    const available = Math.max(0, totalBudget - totalCommitted);
    const utilizationPercent = totalBudget > 0
      ? Math.round((totalActual / totalBudget) * 100 * 100) / 100
      : 0;

    const network = networkRows[0] || {
      total_drops: 0,
      completed_drops: 0,
    };

    const totalDrops = Number(network.total_drops) || 0;
    const completedDrops = Number(network.completed_drops) || 0;
    const progressPercent = totalDrops > 0
      ? Math.round((completedDrops / totalDrops) * 100 * 100) / 100
      : 0;

    // H&S compliance - run separately with fallbacks
    let compliance = {
      avg_hs_score: 0,
      open_incidents: 0,
      pending_audits: 0,
    };

    try {
      const incidentRows = await sql`
        SELECT COUNT(*)::int as count
        FROM tickets t
        JOIN hs_ticket_details htd ON htd.ticket_id = t.id
        WHERE t.ticket_type IN ('hse_incident', 'hse_near_miss')
        AND t.status NOT IN ('resolved', 'closed', 'cancelled')
      `;
      compliance.open_incidents = incidentRows[0]?.count || 0;
    } catch {
      // H&S tables may not exist yet
    }

    try {
      const auditRows = await sql`
        SELECT COUNT(*)::int as count
        FROM hs_project_audits
        WHERE status IN ('in_progress', 'requires_action')
      `;
      compliance.pending_audits = auditRows[0]?.count || 0;
    } catch {
      // hs_project_audits table may not exist yet
    }

    const maintenance = maintenanceRows[0] || {
      open_tickets: 0,
      critical_tickets: 0,
    };

    const expiringDocs = expiringDocsRows[0] || {
      count_30_days: 0,
      count_60_days: 0,
      count_90_days: 0,
    };

    const atRiskCount = atRiskRows[0]?.at_risk_count || 0;

    const response: PortfolioDashboardResponse = {
      counts: {
        total: counts.total_projects,
        pipeline: counts.pipeline_count,
        planned: counts.planned_count,
        active: counts.active_count,
        completed: counts.completed_count,
        onHold: counts.on_hold_count,
        atRisk: atRiskCount,
      },
      budget: {
        totalBudget,
        totalCommitted,
        totalActual,
        available,
        utilizationPercent,
        health: calculateBudgetHealth(utilizationPercent),
      },
      network: {
        totalDrops,
        completedDrops,
        progressPercent,
      },
      compliance: {
        avgHsScore: Math.round(Number(compliance.avg_hs_score) || 0),
        openIncidents: compliance.open_incidents || 0,
        pendingAudits: compliance.pending_audits || 0,
      },
      maintenance: {
        openTickets: maintenance.open_tickets || 0,
        criticalTickets: maintenance.critical_tickets || 0,
      },
      expiringDocs: {
        count30Days: expiringDocs.count_30_days || 0,
        count60Days: expiringDocs.count_60_days || 0,
        count90Days: expiringDocs.count_90_days || 0,
      },
      recentProjects: recentProjects || [],
    };

    log.info('Portfolio dashboard metrics fetched', {
      projectCount: response.counts.total,
      activeCount: response.counts.active,
    });

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('Failed to fetch portfolio dashboard metrics', { error });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);
