/**
 * Chat Data Query API
 *
 * POST /api/chat/query
 * Body: { queryId: string, params?: Record<string, any> }
 *
 * Executes pre-defined read-only queries. No arbitrary SQL.
 * Access controlled via system_feature_settings + RBAC.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { userHasPermission } from '@/lib/permissions';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth/middleware';

const logger = createLogger('api:chat:query');

// ── Pre-defined queries ──────────────────────────────────────────

interface QueryDef {
  id: string;
  name: string;
  description: string;
  sql: string;
  params?: string[]; // named params from request
  format?: 'table' | 'single' | 'count';
}

const QUERIES: QueryDef[] = [
  // Activate / QA
  {
    id: 'activations_yesterday',
    name: 'OES Activations Yesterday',
    description: 'Number of homes/drops activated in OES yesterday',
    sql: `SELECT COUNT(*) as count FROM oes_activations WHERE activation_date = CURRENT_DATE - 1`,
    format: 'count',
  },
  {
    id: 'activations_today',
    name: 'OES Activations Today',
    description: 'Number of homes/drops activated in OES today so far',
    sql: `SELECT COUNT(*) as count FROM oes_activations WHERE activation_date = CURRENT_DATE`,
    format: 'count',
  },
  {
    id: 'activations_this_week',
    name: 'OES Activations This Week',
    description: 'Number of homes/drops activated in OES in the last 7 days',
    sql: `SELECT activation_date, COUNT(*) as count FROM oes_activations WHERE activation_date >= CURRENT_DATE - 7 GROUP BY activation_date ORDER BY activation_date DESC`,
    format: 'table',
  },
  {
    id: 'activations_this_month',
    name: 'OES Activations This Month',
    description: 'Number of homes/drops activated in OES in the last 30 days',
    sql: `SELECT COUNT(*) as count FROM oes_activations WHERE activation_date >= CURRENT_DATE - 30`,
    format: 'count',
  },
  {
    id: 'activations_by_team',
    name: 'Activations by Team',
    description: 'Activation counts per team in the last 7 days',
    sql: `SELECT COALESCE(team, 'Unknown') as team, COUNT(*) as count FROM oes_activations WHERE activation_date >= CURRENT_DATE - 7 GROUP BY team ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'qa_yesterday',
    name: 'QA Yesterday',
    description: 'QA photo review decisions made yesterday (pass/fail/rework)',
    sql: `SELECT qa_decision, COUNT(*) as count FROM dr_photo_unified_reviews WHERE qa_decision IS NOT NULL AND qa_decision_at::date = CURRENT_DATE - 1 GROUP BY qa_decision ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'qa_today',
    name: 'QA Today',
    description: 'QA photo review decisions made today so far',
    sql: `SELECT qa_decision, COUNT(*) as count FROM dr_photo_unified_reviews WHERE qa_decision IS NOT NULL AND qa_decision_at::date = CURRENT_DATE GROUP BY qa_decision ORDER BY count DESC`,
    format: 'table',
  },
  {
    name: 'QA Summary',
    description: 'Get QA decision counts (total PASS/FAIL/REWORK)',
    sql: `SELECT qa_decision, COUNT(*) as count FROM dr_photo_unified_reviews WHERE qa_decision IS NOT NULL GROUP BY qa_decision ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'qa_this_week',
    name: 'QA This Week',
    description: 'QA decisions made in the last 7 days',
    sql: `SELECT qa_decision, COUNT(*) as count FROM dr_photo_unified_reviews WHERE qa_decision IS NOT NULL AND qa_decision_at > NOW() - INTERVAL '7 days' GROUP BY qa_decision ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'qa_this_month',
    name: 'QA This Month',
    description: 'QA decisions made in the last 30 days',
    sql: `SELECT qa_decision, COUNT(*) as count FROM dr_photo_unified_reviews WHERE qa_decision IS NOT NULL AND qa_decision_at > NOW() - INTERVAL '30 days' GROUP BY qa_decision ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'qa_pending',
    name: 'QA Pending',
    description: 'Number of DRs pending QA review',
    sql: `SELECT COUNT(*) as count FROM dr_photo_unified_reviews WHERE qa_decision IS NULL`,
    format: 'count',
  },
  {
    id: 'qa_by_project',
    name: 'QA by Project',
    description: 'QA pass/fail counts grouped by project',
    sql: `SELECT p.name as project, qa_decision, COUNT(*) as count FROM dr_photo_unified_reviews dr JOIN projects p ON dr.project_id = p.id WHERE qa_decision IS NOT NULL GROUP BY p.name, qa_decision ORDER BY p.name, count DESC`,
    format: 'table',
  },

  // Construction QA
  {
    id: 'cqa_summary',
    name: 'Construction QA Summary',
    description: 'Construction QA review counts by workflow status',
    sql: `SELECT workflow_status, COUNT(*) as count FROM construction_qa_reviews GROUP BY workflow_status ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'cqa_by_project',
    name: 'Construction QA by Project',
    description: 'Construction QA review counts grouped by project',
    sql: `SELECT p.project_name as project, r.workflow_status, COUNT(*) as count FROM construction_qa_reviews r JOIN projects p ON r.project_id = p.id GROUP BY p.project_name, r.workflow_status ORDER BY p.project_name, count DESC`,
    format: 'table',
  },
  {
    id: 'cqa_pending',
    name: 'Construction QA Pending',
    description: 'Number of construction QA reviews pending or in review',
    sql: `SELECT COUNT(*) as count FROM construction_qa_reviews WHERE workflow_status IN ('pending', 'in_review', 'escalated')`,
    format: 'count',
  },
  {
    id: 'cqa_pass_rate',
    name: 'Construction QA Pass Rate',
    description: 'Construction QA pass/fail/rework counts for decided reviews',
    sql: `SELECT qa_decision, COUNT(*) as count, ROUND(COUNT(*)::numeric * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) as percentage FROM construction_qa_reviews WHERE qa_decision IS NOT NULL GROUP BY qa_decision ORDER BY count DESC`,
    format: 'table',
  },

  // Maintenance
  {
    id: 'maintenance_summary',
    name: 'Maintenance Summary',
    description: 'Ticket counts by status',
    sql: `SELECT status, COUNT(*) as count FROM maintenance_tickets GROUP BY status ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'maintenance_open',
    name: 'Open Maintenance Tickets',
    description: 'Count of open/new/in_progress tickets',
    sql: `SELECT COUNT(*) as count FROM maintenance_tickets WHERE status IN ('new', 'open', 'assigned', 'in_progress')`,
    format: 'count',
  },
  {
    id: 'maintenance_this_week',
    name: 'Maintenance This Week',
    description: 'Tickets created in the last 7 days',
    sql: `SELECT status, COUNT(*) as count FROM maintenance_tickets WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY status ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'maintenance_overdue',
    name: 'Overdue Tickets',
    description: 'Tickets that have exceeded their SLA target',
    sql: `SELECT COUNT(*) as count FROM maintenance_tickets WHERE status NOT IN ('closed', 'resolved') AND sla_deadline < NOW()`,
    format: 'count',
  },

  // Projects
  {
    id: 'projects_summary',
    name: 'Projects Summary',
    description: 'Project counts by status',
    sql: `SELECT LOWER(status) as status, COUNT(*) as count FROM projects GROUP BY LOWER(status) ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'projects_active',
    name: 'Active Projects',
    description: 'List of active projects with key info',
    sql: `SELECT name, status, created_at FROM projects WHERE LOWER(status) = 'active' ORDER BY created_at DESC LIMIT 20`,
    format: 'table',
  },

  // Staff / HR
  {
    id: 'staff_count',
    name: 'Staff Count',
    description: 'Total number of staff members',
    sql: `SELECT COUNT(*) as count FROM staff`,
    format: 'count',
  },
  {
    id: 'staff_by_department',
    name: 'Staff by Department',
    description: 'Staff count per department',
    sql: `SELECT COALESCE(d.name, 'Unassigned') as department, COUNT(*) as count FROM staff s LEFT JOIN departments d ON s.department_id = d.id GROUP BY d.name ORDER BY count DESC`,
    format: 'table',
  },

  // Fleet
  {
    id: 'fleet_summary',
    name: 'Fleet Summary',
    description: 'Vehicle counts by status',
    sql: `SELECT status, COUNT(*) as count FROM fleet_vehicles GROUP BY status ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'fleet_checkins_today',
    name: 'Fleet Check-ins Today',
    description: 'Number of vehicle check-ins today',
    sql: `SELECT COUNT(*) as count FROM fleet_check_records WHERE created_at > CURRENT_DATE`,
    format: 'count',
  },

  // Procurement
  {
    id: 'po_summary',
    name: 'Purchase Orders Summary',
    description: 'PO counts by status',
    sql: `SELECT status, COUNT(*) as count FROM purchase_orders GROUP BY status ORDER BY count DESC`,
    format: 'table',
  },
  {
    id: 'po_pending_approval',
    name: 'POs Pending Approval',
    description: 'Number of purchase orders awaiting approval',
    sql: `SELECT COUNT(*) as count FROM purchase_orders WHERE status = 'pending_approval'`,
    format: 'count',
  },

  // Assets
  {
    id: 'assets_summary',
    name: 'Assets Summary',
    description: 'Asset counts by status',
    sql: `SELECT status, COUNT(*) as count FROM assets GROUP BY status ORDER BY count DESC`,
    format: 'table',
  },

  // Technicians
  {
    id: 'technician_performance',
    name: 'Technician Performance',
    description: 'Top technicians by QA pass count (last 30 days)',
    sql: `SELECT t.name as technician, COUNT(*) FILTER (WHERE dr.qa_decision = 'PASS') as passed, COUNT(*) FILTER (WHERE dr.qa_decision = 'FAIL') as failed, COUNT(*) as total FROM dr_photo_unified_reviews dr JOIN technicians t ON dr.technician_id = t.id WHERE dr.qa_decision IS NOT NULL AND dr.qa_decision_at > NOW() - INTERVAL '30 days' GROUP BY t.name ORDER BY total DESC LIMIT 15`,
    format: 'table',
  },
];

// ── Handler ──────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Only POST requests allowed');
  }

  // ── Authentication Check ──
  const user = (req as any).user;
  if (!user || !user.id) {
    logger.warn('Unauthorized query attempt', { ip: req.socket.remoteAddress });
    return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Authentication required');
  }

  // ── RBAC Permission Check ──
  try {
    const hasAccess = await userHasPermission(
      user.id,
      'communications.chat-data-lookups',
      'view'
    );

    if (!hasAccess) {
      logger.warn('Unauthorized data query attempt', {
        userId: user.id,
        userName: user.name,
        role: user.role
      });
      return apiResponse.error(
        res,
        ErrorCode.FORBIDDEN,
        'You do not have permission to access data queries. Contact your administrator.'
      );
    }
  } catch (permErr: any) {
    logger.error('Permission check failed', { error: permErr.message, userId: user.id });
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Permission check failed');
  }

  // ── Validate Query ID ──
  const { queryId } = req.body;
  if (!queryId) {
    return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'queryId is required');
  }

  const queryDef = QUERIES.find(q => q.id === queryId);
  if (!queryDef) {
    logger.warn('Unknown query requested', { queryId, userId: user.id });
    return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, `Unknown query: ${queryId}`);
  }

  // ── Execute Query ──
  try {
    logger.info('Executing data query', {
      queryId,
      queryName: queryDef.name,
      userId: user.id,
      userName: user.name
    });

    const result = await pool.query(queryDef.sql);

    let formatted: string;
    if (queryDef.format === 'count') {
      formatted = `${queryDef.name}: ${result.rows[0]?.count ?? 0}`;
    } else {
      // Format as readable text table
      if (result.rows.length === 0) {
        formatted = `${queryDef.name}: No data found.`;
      } else {
        const cols = Object.keys(result.rows[0]);
        const lines = result.rows.map(row =>
          cols.map(c => `${c}: ${row[c] ?? 'N/A'}`).join(' | ')
        );
        formatted = `${queryDef.name}:\n${lines.join('\n')}`;
      }
    }

    logger.info('Query executed successfully', {
      queryId,
      rowCount: result.rows.length,
      userId: user.id
    });

    return apiResponse.success(res, {
      data: result.rows,
      formatted,
      queryId,
      queryName: queryDef.name,
    });
  } catch (err: any) {
    logger.error('Query execution failed', {
      queryId,
      error: err.message,
      stack: err.stack,
      userId: user.id
    });
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Query execution failed');
  }
}

export default withAuth(handler);

// Export query definitions for the chat API to use as function descriptions
export { QUERIES };
