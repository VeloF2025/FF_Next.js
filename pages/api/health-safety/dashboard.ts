/**
 * H&S Dashboard API
 *
 * GET /api/health-safety/dashboard - Get aggregated H&S metrics
 *
 * Returns:
 * - Overall safety score
 * - Incident statistics
 * - Contractor compliance overview
 * - Project audit status
 * - Upcoming audits
 * - Recent activity
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
  }

  try {
    const { project_id, contractor_id, date_from, date_to } = req.query;

    // Default date range: last 12 months
    const fromDate = date_from || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const toDate = date_to || new Date().toISOString();

    // Batch 1: All independent queries + tickets table check (parallel)
    const [
      ticketsTableExists,
      contractorStats,
      contractorsAtRisk,
      auditStatsResult,
      projectRagStats,
      upcomingAudits,
      overdueAudits,
      recentActivity,
      latestAuditPerProject,
      totalProjectsResult,
    ] = await Promise.all([
      // Check if maintenance_tickets table exists
      sql`SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'maintenance_tickets'
      ) as exists`,

      // Contractor compliance overview — explicit branches to avoid conditional SQL fragments (Neon rule)
      contractor_id
        ? sql`SELECT cc.rag_status, COUNT(*)::int as count
              FROM hs_contractor_compliance cc JOIN contractors c ON c.id = cc.contractor_id
              WHERE c.status IN ('approved', 'active', 'pending') AND cc.contractor_id = ${contractor_id}
              GROUP BY cc.rag_status`
        : sql`SELECT cc.rag_status, COUNT(*)::int as count
              FROM hs_contractor_compliance cc JOIN contractors c ON c.id = cc.contractor_id
              WHERE c.status IN ('approved', 'active', 'pending')
              GROUP BY cc.rag_status`,

      // Contractors at risk (red/amber)
      contractor_id
        ? sql`SELECT c.id, c.company_name, cc.overall_score, cc.rag_status, cc.next_audit_due
              FROM hs_contractor_compliance cc JOIN contractors c ON c.id = cc.contractor_id
              WHERE c.status IN ('approved', 'active', 'pending')
                AND cc.rag_status IN ('red', 'amber') AND cc.contractor_id = ${contractor_id}
              ORDER BY cc.overall_score ASC LIMIT 10`
        : sql`SELECT c.id, c.company_name, cc.overall_score, cc.rag_status, cc.next_audit_due
              FROM hs_contractor_compliance cc JOIN contractors c ON c.id = cc.contractor_id
              WHERE c.status IN ('approved', 'active', 'pending')
                AND cc.rag_status IN ('red', 'amber')
              ORDER BY cc.overall_score ASC LIMIT 10`,

      // Project audit statistics
      project_id
        ? sql`SELECT COUNT(*)::int as total_audits,
                COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
                COUNT(*) FILTER (WHERE status = 'requires_action')::int as requires_action,
                COUNT(*) FILTER (WHERE status = 'in_progress')::int as in_progress,
                AVG(overall_score)::int as average_score
              FROM hs_project_audits
              WHERE audit_date >= ${fromDate} AND audit_date <= ${toDate}
                AND project_id = ${project_id}`
        : sql`SELECT COUNT(*)::int as total_audits,
                COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
                COUNT(*) FILTER (WHERE status = 'requires_action')::int as requires_action,
                COUNT(*) FILTER (WHERE status = 'in_progress')::int as in_progress,
                AVG(overall_score)::int as average_score
              FROM hs_project_audits
              WHERE audit_date >= ${fromDate} AND audit_date <= ${toDate}`,

      // Projects by RAG status
      project_id
        ? sql`SELECT rag_status, COUNT(*)::int as count FROM hs_project_audits
              WHERE status IN ('completed', 'requires_action')
                AND audit_date >= ${fromDate} AND audit_date <= ${toDate}
                AND project_id = ${project_id}
              GROUP BY rag_status`
        : sql`SELECT rag_status, COUNT(*)::int as count FROM hs_project_audits
              WHERE status IN ('completed', 'requires_action')
                AND audit_date >= ${fromDate} AND audit_date <= ${toDate}
              GROUP BY rag_status`,

      // Upcoming audits
      project_id
        ? sql`SELECT pc.project_id, p.project_name, pc.next_audit_due, pc.audit_frequency,
                (SELECT overall_score FROM hs_project_audits
                 WHERE project_id = pc.project_id ORDER BY audit_date DESC LIMIT 1) as last_score
              FROM hs_project_config pc JOIN projects p ON p.id = pc.project_id
              WHERE pc.next_audit_due IS NOT NULL
                AND pc.next_audit_due <= NOW() + INTERVAL '14 days'
                AND pc.project_id = ${project_id}
              ORDER BY pc.next_audit_due ASC LIMIT 10`
        : sql`SELECT pc.project_id, p.project_name, pc.next_audit_due, pc.audit_frequency,
                (SELECT overall_score FROM hs_project_audits
                 WHERE project_id = pc.project_id ORDER BY audit_date DESC LIMIT 1) as last_score
              FROM hs_project_config pc JOIN projects p ON p.id = pc.project_id
              WHERE pc.next_audit_due IS NOT NULL
                AND pc.next_audit_due <= NOW() + INTERVAL '14 days'
              ORDER BY pc.next_audit_due ASC LIMIT 10`,

      // Overdue audits
      project_id
        ? sql`SELECT pc.project_id, p.project_name, pc.next_audit_due, pc.audit_frequency
              FROM hs_project_config pc JOIN projects p ON p.id = pc.project_id
              WHERE pc.next_audit_due < NOW() AND pc.project_id = ${project_id}
              ORDER BY pc.next_audit_due ASC`
        : sql`SELECT pc.project_id, p.project_name, pc.next_audit_due, pc.audit_frequency
              FROM hs_project_config pc JOIN projects p ON p.id = pc.project_id
              WHERE pc.next_audit_due < NOW()
              ORDER BY pc.next_audit_due ASC`,

      // Recent activity
      sql`SELECT *
      FROM hs_activity_log
      ORDER BY created_at DESC
      LIMIT 20`,

      // Latest audit per project (for overall score)
      sql`SELECT DISTINCT ON (project_id) project_id, rag_status
      FROM hs_project_audits
      WHERE status IN ('completed', 'requires_action')
      AND rag_status IS NOT NULL
      ORDER BY project_id, audit_date DESC`,

      // Total configured projects
      sql`SELECT COUNT(*)::int as count FROM hs_project_config`,
    ]);

    const hasTickets = ticketsTableExists[0]?.exists;
    const auditStats = auditStatsResult[0];
    const totalProjects = totalProjectsResult[0].count;

    // Batch 2: Incident queries (conditional, depend on hasTickets)
    let incidentStats = {
      total_incidents: 0,
      critical: 0,
      major: 0,
      moderate: 0,
      minor: 0,
      near_misses: 0,
      open_incidents: 0,
      dol_reportable: 0,
      dol_pending: 0,
      ca_pending: 0,
    };
    let incidentTrend: any[] = [];

    if (hasTickets) {
      // Explicit branches to avoid conditional SQL fragments in incident queries (Neon rule)
      let statsQuery;
      let trendQuery;
      if (project_id && contractor_id) {
        statsQuery = sql`
          SELECT COUNT(*)::int as total_incidents,
            COUNT(*) FILTER (WHERE hd.severity = 'critical')::int as critical,
            COUNT(*) FILTER (WHERE hd.severity = 'major')::int as major,
            COUNT(*) FILTER (WHERE hd.severity = 'moderate')::int as moderate,
            COUNT(*) FILTER (WHERE hd.severity = 'minor')::int as minor,
            COUNT(*) FILTER (WHERE t.source_type = 'hse_near_miss')::int as near_misses,
            COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'resolved'))::int as open_incidents,
            COUNT(*) FILTER (WHERE hd.dol_reportable = true)::int as dol_reportable,
            COUNT(*) FILTER (WHERE hd.dol_reportable = true AND hd.dol_reported = false)::int as dol_pending,
            COUNT(*) FILTER (WHERE hd.corrective_action_required = true AND t.status NOT IN ('closed', 'resolved'))::int as ca_pending
          FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
          WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
            AND t.created_at >= ${fromDate} AND t.created_at <= ${toDate}
            AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        `;
        trendQuery = sql`
          SELECT DATE_TRUNC('month', t.created_at) as month,
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE hd.severity IN ('critical', 'major'))::int as severe
          FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
          WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
            AND t.created_at >= ${fromDate} AND t.created_at <= ${toDate}
            AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
          GROUP BY DATE_TRUNC('month', t.created_at) ORDER BY month DESC LIMIT 12
        `;
      } else if (project_id) {
        statsQuery = sql`
          SELECT COUNT(*)::int as total_incidents,
            COUNT(*) FILTER (WHERE hd.severity = 'critical')::int as critical,
            COUNT(*) FILTER (WHERE hd.severity = 'major')::int as major,
            COUNT(*) FILTER (WHERE hd.severity = 'moderate')::int as moderate,
            COUNT(*) FILTER (WHERE hd.severity = 'minor')::int as minor,
            COUNT(*) FILTER (WHERE t.source_type = 'hse_near_miss')::int as near_misses,
            COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'resolved'))::int as open_incidents,
            COUNT(*) FILTER (WHERE hd.dol_reportable = true)::int as dol_reportable,
            COUNT(*) FILTER (WHERE hd.dol_reportable = true AND hd.dol_reported = false)::int as dol_pending,
            COUNT(*) FILTER (WHERE hd.corrective_action_required = true AND t.status NOT IN ('closed', 'resolved'))::int as ca_pending
          FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
          WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
            AND t.created_at >= ${fromDate} AND t.created_at <= ${toDate}
            AND t.project_id = ${project_id}
        `;
        trendQuery = sql`
          SELECT DATE_TRUNC('month', t.created_at) as month,
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE hd.severity IN ('critical', 'major'))::int as severe
          FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
          WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
            AND t.created_at >= ${fromDate} AND t.created_at <= ${toDate}
            AND t.project_id = ${project_id}
          GROUP BY DATE_TRUNC('month', t.created_at) ORDER BY month DESC LIMIT 12
        `;
      } else if (contractor_id) {
        statsQuery = sql`
          SELECT COUNT(*)::int as total_incidents,
            COUNT(*) FILTER (WHERE hd.severity = 'critical')::int as critical,
            COUNT(*) FILTER (WHERE hd.severity = 'major')::int as major,
            COUNT(*) FILTER (WHERE hd.severity = 'moderate')::int as moderate,
            COUNT(*) FILTER (WHERE hd.severity = 'minor')::int as minor,
            COUNT(*) FILTER (WHERE t.source_type = 'hse_near_miss')::int as near_misses,
            COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'resolved'))::int as open_incidents,
            COUNT(*) FILTER (WHERE hd.dol_reportable = true)::int as dol_reportable,
            COUNT(*) FILTER (WHERE hd.dol_reportable = true AND hd.dol_reported = false)::int as dol_pending,
            COUNT(*) FILTER (WHERE hd.corrective_action_required = true AND t.status NOT IN ('closed', 'resolved'))::int as ca_pending
          FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
          WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
            AND t.created_at >= ${fromDate} AND t.created_at <= ${toDate}
            AND t.contractor_id = ${contractor_id}
        `;
        trendQuery = sql`
          SELECT DATE_TRUNC('month', t.created_at) as month,
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE hd.severity IN ('critical', 'major'))::int as severe
          FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
          WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
            AND t.created_at >= ${fromDate} AND t.created_at <= ${toDate}
            AND t.contractor_id = ${contractor_id}
          GROUP BY DATE_TRUNC('month', t.created_at) ORDER BY month DESC LIMIT 12
        `;
      } else {
        statsQuery = sql`
          SELECT COUNT(*)::int as total_incidents,
            COUNT(*) FILTER (WHERE hd.severity = 'critical')::int as critical,
            COUNT(*) FILTER (WHERE hd.severity = 'major')::int as major,
            COUNT(*) FILTER (WHERE hd.severity = 'moderate')::int as moderate,
            COUNT(*) FILTER (WHERE hd.severity = 'minor')::int as minor,
            COUNT(*) FILTER (WHERE t.source_type = 'hse_near_miss')::int as near_misses,
            COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'resolved'))::int as open_incidents,
            COUNT(*) FILTER (WHERE hd.dol_reportable = true)::int as dol_reportable,
            COUNT(*) FILTER (WHERE hd.dol_reportable = true AND hd.dol_reported = false)::int as dol_pending,
            COUNT(*) FILTER (WHERE hd.corrective_action_required = true AND t.status NOT IN ('closed', 'resolved'))::int as ca_pending
          FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
          WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
            AND t.created_at >= ${fromDate} AND t.created_at <= ${toDate}
        `;
        trendQuery = sql`
          SELECT DATE_TRUNC('month', t.created_at) as month,
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE hd.severity IN ('critical', 'major'))::int as severe
          FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
          WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
            AND t.created_at >= ${fromDate} AND t.created_at <= ${toDate}
          GROUP BY DATE_TRUNC('month', t.created_at) ORDER BY month DESC LIMIT 12
        `;
      }

      const [statsResult, trendResult] = await Promise.all([statsQuery, trendQuery]);

      incidentStats = statsResult[0] || incidentStats;
      incidentTrend = trendResult;
    }
    const greenProjects = latestAuditPerProject.filter((p: any) => p.rag_status === 'green').length;
    const amberProjects = latestAuditPerProject.filter((p: any) => p.rag_status === 'amber').length;
    const redProjects = latestAuditPerProject.filter((p: any) => p.rag_status === 'red').length;
    const auditedProjects = greenProjects + amberProjects + redProjects;

    // Weighted score: green=100, amber=60, red=20
    const overallScore =
      auditedProjects > 0
        ? Math.round((greenProjects * 100 + amberProjects * 60 + redProjects * 20) / auditedProjects)
        : 100;

    const overallRag = overallScore < 50 ? 'red' : overallScore < 80 ? 'amber' : 'green';

    return apiResponse.success(res, {
      overall: {
        score: overallScore,
        rag_status: overallRag,
        total_projects_configured: totalProjects,
      },
      incidents: {
        stats: incidentStats,
        trend: incidentTrend,
        alerts: {
          critical_open: incidentStats?.critical || 0,
          dol_pending: incidentStats?.dol_pending || 0,
          ca_pending: incidentStats?.ca_pending || 0,
        },
      },
      contractors: {
        stats: contractorStats,
        at_risk: contractorsAtRisk,
        by_rag: {
          green: contractorStats.find((c: any) => c.rag_status === 'green')?.count || 0,
          amber: contractorStats.find((c: any) => c.rag_status === 'amber')?.count || 0,
          red: contractorStats.find((c: any) => c.rag_status === 'red')?.count || 0,
        },
      },
      audits: {
        stats: auditStats,
        by_rag: {
          green: projectRagStats.find((p: any) => p.rag_status === 'green')?.count || 0,
          amber: projectRagStats.find((p: any) => p.rag_status === 'amber')?.count || 0,
          red: projectRagStats.find((p: any) => p.rag_status === 'red')?.count || 0,
        },
        upcoming: upcomingAudits,
        overdue: overdueAudits,
        overdue_count: overdueAudits.length,
      },
      recent_activity: recentActivity,
      date_range: {
        from: fromDate,
        to: toDate,
      },
    });
  } catch (error) {
    log.error('[H&S Dashboard API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
