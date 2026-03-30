/**
 * Project Dashboard Service
 * Sprint 1: Project Hub Foundation
 *
 * TDD Phase: GREEN - Implementation complete
 */

import { neon } from '@/lib/db-neon';

const getSql = () => neon(process.env.DATABASE_URL!);

export interface BudgetMetrics {
  total: number;
  committed: number;
  actual: number;
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export interface TeamMetrics {
  staffCount: number;
  contractorCount: number;
}

export interface HSMetrics {
  latestScore: number | null;
  complianceStatus: 'compliant' | 'non-compliant' | 'unknown';
  lastAuditDate?: string;
}

export interface MaintenanceMetrics {
  openTickets: number;
}

export interface ProcurementMetrics {
  pendingPOs: number;
  pendingRFQs: number;
}

export interface AggregatedMetrics {
  budget: BudgetMetrics;
  team: TeamMetrics;
  hs: HSMetrics;
  maintenance: MaintenanceMetrics;
  procurement: ProcurementMetrics;
}

export interface Activity {
  id: string;
  module: 'procurement' | 'maintenance' | 'hs' | 'budget';
  description: string;
  timestamp: string;
}

export interface TimelineOptions {
  limit?: number;
}

export interface ProcurementSummary {
  boqs: number;
  rfqs: number;
  pos: number;
  grns: number;
  totalPoValue: number;
  totalGrnValue: number;
  pendingPOs: number;
  pendingRFQs: number;
}

export interface MaintenanceSummary {
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  avgResolutionHours: number | null;
}

export interface HSSummary {
  latestScore: number | null;
  complianceStatus: 'compliant' | 'non-compliant' | 'unknown';
  lastAuditDate?: string;
}

/**
 * Aggregate metrics from all modules for a project
 * @param projectId - Project UUID
 * @returns Aggregated metrics
 */
export async function aggregateMetrics(projectId: string): Promise<AggregatedMetrics> {
  const sql = getSql();

  const result = await sql`
    SELECT *
    FROM v_project_dashboard
    WHERE id = ${projectId}
  `;

  if (!result || result.length === 0) {
    return {
      budget: { total: 0, committed: 0, actual: 0, health: 'unknown' },
      team: { staffCount: 0, contractorCount: 0 },
      hs: { latestScore: null, complianceStatus: 'unknown' },
      maintenance: { openTickets: 0 },
      procurement: { pendingPOs: 0, pendingRFQs: 0 },
    };
  }

  const row = result[0];

  return {
    budget: {
      total: Number(row.total_budget) || Number(row.budget) || 0,
      committed: Number(row.committed_amount) || 0,
      actual: Number(row.budget_actual_amount) || Number(row.actual_cost) || 0,
      health: (row.budget_health as 'healthy' | 'warning' | 'critical' | 'unknown') || 'unknown',
    },
    team: {
      staffCount: Number(row.staff_count) || 0,
      contractorCount: Number(row.contractor_count) || 0,
    },
    hs: {
      latestScore: row.latest_hs_score ? Number(row.latest_hs_score) : null,
      complianceStatus: row.latest_hs_score
        ? Number(row.latest_hs_score) >= 80 ? 'compliant' : 'non-compliant'
        : 'unknown',
      lastAuditDate: row.last_audit_date?.toISOString?.() || row.last_audit_date,
    },
    maintenance: {
      openTickets: Number(row.open_tickets) || 0,
    },
    procurement: {
      pendingPOs: Number(row.pending_pos) || 0,
      pendingRFQs: Number(row.pending_rfqs) || 0,
    },
  };
}

/**
 * Get activity timeline combining all modules
 * @param projectId - Project UUID
 * @param options - Query options
 * @returns Array of activities
 */
export async function getActivityTimeline(
  projectId: string,
  options: TimelineOptions = {}
): Promise<Activity[]> {
  const sql = getSql();
  const limit = options.limit || 20;

  const result = await sql`
    -- Purchase Orders
    SELECT
      id::text as id,
      'procurement' as module,
      'PO ' || po_number || ' ' || status as description,
      COALESCE(updated_at, created_at) as timestamp
    FROM purchase_orders
    WHERE project_id = ${projectId}

    UNION ALL

    -- Maintenance Tickets
    SELECT
      id::text as id,
      'maintenance' as module,
      'Ticket ' || ticket_uid || ' ' || status as description,
      COALESCE(resolved_at, updated_at, created_at) as timestamp
    FROM maintenance_tickets
    WHERE project_id::text = ${projectId}

    UNION ALL

    -- H&S Audits
    SELECT
      id::text as id,
      'hs' as module,
      'H&S Audit - Score: ' || overall_score || '%' as description,
      created_at as timestamp
    FROM hs_project_audits
    WHERE project_id = ${projectId}

    ORDER BY timestamp DESC NULLS LAST
    LIMIT ${limit}
  `;

  return result.map(row => ({
    id: row.id,
    module: row.module as 'procurement' | 'maintenance' | 'hs' | 'budget',
    description: row.description,
    timestamp: row.timestamp?.toISOString?.() || new Date().toISOString(),
  }));
}

/**
 * Get procurement summary for a project
 * @param projectId - Project UUID
 * @returns Procurement summary
 */
export async function getProcurementSummary(projectId: string): Promise<ProcurementSummary> {
  const sql = getSql();

  // 🟢 WORKING: All 5 queries are independent — run in parallel for ~5x speedup
  const [boqs, rfqs, pos, grns, openRfqs] = await Promise.all([
    sql`SELECT COUNT(*) as count FROM boqs WHERE project_id = ${projectId}`,
    sql`SELECT COUNT(*) as count FROM rfqs WHERE project_id::text = ${projectId}`,
    sql`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as total_value,
        COUNT(*) FILTER (WHERE status = 'pending_approval') as pending
      FROM purchase_orders WHERE project_id = ${projectId}
    `,
    sql`
      SELECT COUNT(*) as count, COALESCE(SUM(total_received_value), 0) as total_value
      FROM goods_receipt_notes WHERE project_id = ${projectId}
    `,
    sql`
      SELECT COUNT(*) as count FROM rfqs
      WHERE project_id::text = ${projectId} AND status = 'open'
    `,
  ]);

  return {
    boqs: Number(boqs[0]?.count) || 0,
    rfqs: Number(rfqs[0]?.count) || 0,
    pos: Number(pos[0]?.count) || 0,
    grns: Number(grns[0]?.count) || 0,
    totalPoValue: Number(pos[0]?.total_value) || 0,
    totalGrnValue: Number(grns[0]?.total_value) || 0,
    pendingPOs: Number(pos[0]?.pending) || 0,
    pendingRFQs: Number(openRfqs[0]?.count) || 0,
  };
}

/**
 * Get maintenance summary for a project
 * @param projectId - Project UUID
 * @returns Maintenance summary
 */
export async function getMaintenanceSummary(projectId: string): Promise<MaintenanceSummary> {
  const sql = getSql();

  // 🟢 WORKING: Both queries are independent — run in parallel for ~2x speedup
  const [counts, resolution] = await Promise.all([
    sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
        COUNT(*) FILTER (WHERE status = 'closed') as closed
      FROM maintenance_tickets
      WHERE project_id::text = ${projectId}
    `,
    sql`
      SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) as avg_hours
      FROM maintenance_tickets
      WHERE project_id::text = ${projectId} AND resolved_at IS NOT NULL
    `,
  ]);

  return {
    open: Number(counts[0]?.open) || 0,
    inProgress: Number(counts[0]?.in_progress) || 0,
    resolved: Number(counts[0]?.resolved) || 0,
    closed: Number(counts[0]?.closed) || 0,
    avgResolutionHours: resolution[0]?.avg_hours
      ? Math.round(Number(resolution[0].avg_hours) * 10) / 10
      : null,
  };
}

/**
 * Get H&S summary for a project
 * @param projectId - Project UUID
 * @returns H&S summary
 */
export async function getHSSummary(projectId: string): Promise<HSSummary> {
  const sql = getSql();

  const audit = await sql`
    SELECT overall_score, created_at
    FROM hs_project_audits
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!audit || audit.length === 0) {
    return {
      latestScore: null,
      complianceStatus: 'unknown',
    };
  }

  const score = Number(audit[0].overall_score);
  return {
    latestScore: score,
    complianceStatus: score >= 80 ? 'compliant' : 'non-compliant',
    lastAuditDate: audit[0].created_at?.toISOString?.() || audit[0].created_at,
  };
}
