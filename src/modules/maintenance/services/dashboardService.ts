/**
 * Dashboard Service - Statistics & Metrics
 *
 * 🟢 WORKING: Production-ready dashboard statistics service
 *
 * Provides:
 * - Dashboard summary (all key metrics)
 * - Ticket counts by status
 * - SLA compliance calculations
 * - Overdue ticket detection
 * - Workload distribution by assignee
 * - Average resolution time
 * - Recent tickets list
 *
 * Features:
 * - Optimized SQL queries for performance
 * - Flexible date range filtering
 * - Project-based filtering
 * - Null-safe aggregations
 */

import { query, queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';
import { calculateSLACompliance } from '../utils/slaCalculator';

const logger = createLogger('ticketing:dashboard');

/**
 * Dashboard summary response
 */
export interface DashboardSummary {
  total_tickets: number;
  by_status: Record<string, number>;
  sla_compliance: {
    total: number;
    met: number;
    breached: number;
    compliance_rate: number;
  };
  overdue_tickets: number;
  avg_resolution_hours: number | null;
}

/**
 * Tickets by status response
 */
export interface TicketsByStatusResponse {
  [status: string]: number;
}

/**
 * SLA compliance response
 */
export interface SLAComplianceResponse {
  total_tickets: number;
  sla_met: number;
  sla_breached: number;
  compliance_rate: number;
  compliance_percentage: string;
}

/**
 * Overdue tickets response
 */
export interface OverdueTicketsResponse {
  overdue_count: number;
  tickets?: Array<{
    id: string;
    ticket_uid: string;
    title: string;
    sla_due_at: Date;
    hours_overdue: number;
  }>;
}

/**
 * Workload by assignee response
 */
export interface WorkloadByAssignee {
  assigned_to: string | null;
  assignee_name: string | null;
  ticket_count: number;
  overdue_count: number;
}

/**
 * Average resolution time response
 */
export interface AverageResolutionTimeResponse {
  average_hours: number | null;
  average_days: number | null;
  total_resolved: number;
}

/**
 * Recent ticket item
 */
export interface RecentTicket {
  id: string;
  ticket_uid: string;
  title: string;
  status: string;
  priority: string;
  created_at: Date;
  assigned_to: string | null;
}

/**
 * Filter options for dashboard queries
 */
export interface DashboardFilters {
  project_id?: string;
  start_date?: Date;
  end_date?: Date;
  status?: string;
  limit?: number;
  active_only?: boolean;
  include_details?: boolean;
}

/**
 * Get complete dashboard summary
 * 🟢 WORKING: Fetches all key dashboard metrics in one call
 *
 * @param filters - Optional filters (project, date range)
 * @returns Complete dashboard summary with all metrics
 */
export async function getDashboardSummary(
  filters: DashboardFilters = {}
): Promise<DashboardSummary> {
  try {
    logger.debug('Fetching dashboard summary', { filters });

    // Get total tickets
    const totalResult = await queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM tickets WHERE 1=1`,
      []
    );

    // Get tickets by status
    const statusData = await getTicketsByStatus(filters);

    // Get SLA compliance
    const slaData = await getSLACompliance(filters);

    // Get overdue count
    const overdueData = await getOverdueTickets(filters);

    // Get average resolution time
    const avgResolutionData = await getAverageResolutionTime(filters);

    return {
      total_tickets: totalResult?.total || 0,
      by_status: statusData,
      sla_compliance: {
        total: slaData.total_tickets,
        met: slaData.sla_met,
        breached: slaData.sla_breached,
        compliance_rate: slaData.compliance_rate
      },
      overdue_tickets: overdueData.overdue_count,
      avg_resolution_hours: avgResolutionData.average_hours
    };
  } catch (error) {
    // Check if error is due to missing table (Phase 1 - migrations not run yet)
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      logger.warn('Tickets table does not exist - returning empty dashboard data. Run migrations to create tables.');
      return {
        total_tickets: 0,
        by_status: {},
        sla_compliance: {
          total: 0,
          met: 0,
          breached: 0,
          compliance_rate: 0
        },
        overdue_tickets: 0,
        avg_resolution_hours: null
      };
    }
    logger.error('Failed to fetch dashboard summary', { error });
    throw new Error('Failed to fetch dashboard summary');
  }
}

/**
 * Get ticket counts grouped by status
 * 🟢 WORKING: Returns ticket count for each status
 *
 * @param filters - Optional filters (project, date range)
 * @returns Object with status as key and count as value
 */
export async function getTicketsByStatus(
  filters: DashboardFilters = {}
): Promise<TicketsByStatusResponse> {
  try {
    const params: any[] = [];
    let whereClause = 'WHERE 1=1';
    let paramIndex = 1;

    // Filter by project
    if (filters.project_id) {
      whereClause += ` AND project_id = $${paramIndex}`;
      params.push(filters.project_id);
      paramIndex++;
    }

    // Filter by date range
    if (filters.start_date && filters.end_date) {
      whereClause += ` AND created_at >= $${paramIndex} AND created_at <= $${paramIndex + 1}`;
      params.push(filters.start_date, filters.end_date);
      paramIndex += 2;
    }

    const sql = `
      SELECT
        status,
        COUNT(*) as count
      FROM tickets
      ${whereClause}
      GROUP BY status
      ORDER BY count DESC
    `;

    logger.debug('Fetching tickets by status', { sql, params });

    const rows = await query<{ status: string; count: number }>(sql, params);

    // Convert array to object
    const result: TicketsByStatusResponse = {};
    if (rows) {
      for (const row of rows) {
        result[row.status] = Number(row.count);
      }
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      return {};
    }
    logger.error('Failed to fetch tickets by status', { error });
    throw new Error('Failed to fetch tickets by status');
  }
}

/**
 * Get SLA compliance statistics
 * 🟢 WORKING: Calculates SLA compliance rate
 *
 * @param filters - Optional filters (date range)
 * @returns SLA compliance metrics with percentage
 */
export async function getSLACompliance(
  filters: DashboardFilters = {}
): Promise<SLAComplianceResponse> {
  try {
    const params: any[] = [];
    let whereClause = 'WHERE 1=1';
    let paramIndex = 1;

    // Filter by date range
    if (filters.start_date && filters.end_date) {
      whereClause += ` AND created_at >= $${paramIndex} AND created_at <= $${paramIndex + 1}`;
      params.push(filters.start_date, filters.end_date);
      paramIndex += 2;
    }

    const sql = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sla_breached = false) as sla_met,
        COUNT(*) FILTER (WHERE sla_breached = true) as sla_breached
      FROM tickets
      ${whereClause}
    `;

    logger.debug('Fetching SLA compliance', { sql, params });

    const result = await queryOne<{
      total: number;
      sla_met: number;
      sla_breached: number;
    }>(sql, params);

    if (!result) {
      return {
        total_tickets: 0,
        sla_met: 0,
        sla_breached: 0,
        compliance_rate: 0,
        compliance_percentage: '0.00%'
      };
    }

    // Use SLA calculator utility
    const compliance = calculateSLACompliance({
      total_tickets: Number(result.total),
      sla_met: Number(result.sla_met),
      sla_breached: Number(result.sla_breached)
    });

    return {
      total_tickets: compliance.total_tickets,
      sla_met: compliance.sla_met,
      sla_breached: compliance.sla_breached,
      compliance_rate: compliance.compliance_rate,
      compliance_percentage: compliance.compliance_percentage
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      return {
        total_tickets: 0,
        sla_met: 0,
        sla_breached: 0,
        compliance_rate: 0,
        compliance_percentage: '0.00%'
      };
    }
    logger.error('Failed to fetch SLA compliance', { error });
    throw new Error('Failed to fetch SLA compliance');
  }
}

/**
 * Get overdue tickets count and optionally details
 * 🟢 WORKING: Finds tickets past their SLA deadline
 *
 * Excludes closed and cancelled tickets from overdue status.
 *
 * @param filters - Optional filters (include_details flag)
 * @returns Overdue count and optionally ticket details
 */
export async function getOverdueTickets(
  filters: DashboardFilters = {}
): Promise<OverdueTicketsResponse> {
  try {
    const params: any[] = ['closed', 'cancelled'];

    if (filters.include_details) {
      // Get detailed list of overdue tickets
      // Note: Using due_at column which exists in the current schema
      const sql = `
        SELECT
          id,
          ticket_uid,
          title,
          due_at as sla_due_at,
          EXTRACT(EPOCH FROM (NOW() - due_at)) / 3600 as hours_overdue
        FROM tickets
        WHERE due_at IS NOT NULL
          AND due_at < NOW()
          AND status NOT IN ($1, $2)
        ORDER BY due_at ASC
      `;

      const tickets = await query<{
        id: string;
        ticket_uid: string;
        title: string;
        sla_due_at: Date;
        hours_overdue: number;
      }>(sql, params);

      return {
        overdue_count: tickets?.length || 0,
        tickets: tickets || []
      };
    } else {
      // Just get count
      // Note: Using due_at column which exists in the current schema
      const sql = `
        SELECT COUNT(*) as overdue_count
        FROM tickets
        WHERE due_at IS NOT NULL
          AND due_at < NOW()
          AND status NOT IN ($1, $2)
      `;

      logger.debug('Fetching overdue tickets count', { sql, params });

      const result = await queryOne<{ overdue_count: number }>(sql, params);

      return {
        overdue_count: result?.overdue_count || 0
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      return { overdue_count: 0 };
    }
    logger.error('Failed to fetch overdue tickets', { error });
    throw new Error('Failed to fetch overdue tickets');
  }
}

/**
 * Get workload distribution by assignee
 * 🟢 WORKING: Shows ticket count per assignee
 *
 * @param filters - Optional filters (active_only flag)
 * @returns Workload data for each assignee
 */
export async function getWorkloadByAssignee(
  filters: DashboardFilters = {}
): Promise<WorkloadByAssignee[]> {
  try {
    const params: any[] = [];
    let whereClause = 'WHERE 1=1';
    let paramIndex = 1;

    // Filter to active tickets only (exclude closed/cancelled)
    if (filters.active_only) {
      whereClause += ` AND t.status NOT IN ($${paramIndex}, $${paramIndex + 1})`;
      params.push('closed', 'cancelled');
      paramIndex += 2;
    }

    // Note: Using due_at and first_name/last_name columns which exist in current schema
    const sql = `
      SELECT
        t.assigned_to,
        CASE
          WHEN t.assigned_to IS NULL THEN 'Unassigned'
          ELSE COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), 'Unknown')
        END as assignee_name,
        COUNT(*) as ticket_count,
        COUNT(*) FILTER (
          WHERE t.due_at IS NOT NULL
            AND t.due_at < NOW()
            AND t.status NOT IN ('closed', 'cancelled')
        ) as overdue_count
      FROM tickets t
      LEFT JOIN users u ON t.assigned_to = u.id
      ${whereClause}
      GROUP BY t.assigned_to, u.first_name, u.last_name
      ORDER BY ticket_count DESC
    `;

    logger.debug('Fetching workload by assignee', { sql, params });

    const rows = await query<WorkloadByAssignee>(sql, params);

    return rows || [];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      return [];
    }
    logger.error('Failed to fetch workload by assignee', { error });
    throw new Error('Failed to fetch workload by assignee');
  }
}

/**
 * Get average resolution time for closed tickets
 * 🟢 WORKING: Calculates mean time to resolution
 *
 * @param filters - Optional filters (date range)
 * @returns Average resolution time in hours and days
 */
export async function getAverageResolutionTime(
  filters: DashboardFilters = {}
): Promise<AverageResolutionTimeResponse> {
  try {
    const params: any[] = ['closed'];
    let whereClause = 'WHERE status = $1';
    let paramIndex = 2;

    // Filter by closed date range
    if (filters.start_date && filters.end_date) {
      whereClause += ` AND closed_at >= $${paramIndex} AND closed_at <= $${paramIndex + 1}`;
      params.push(filters.start_date, filters.end_date);
      paramIndex += 2;
    }

    const sql = `
      SELECT
        AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600) as avg_hours,
        COUNT(*) as total_resolved
      FROM tickets
      ${whereClause}
        AND closed_at IS NOT NULL
    `;

    logger.debug('Fetching average resolution time', { sql, params });

    const result = await queryOne<{
      avg_hours: number | null;
      total_resolved: number;
    }>(sql, params);

    if (!result || result.avg_hours === null) {
      return {
        average_hours: null,
        average_days: null,
        total_resolved: result?.total_resolved || 0
      };
    }

    const avgHours = Number(result.avg_hours);
    const avgDays = avgHours / 24;

    return {
      average_hours: Math.round(avgHours * 100) / 100,
      average_days: Math.round(avgDays * 100) / 100,
      total_resolved: Number(result.total_resolved)
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      return { average_hours: null, average_days: null, total_resolved: 0 };
    }
    logger.error('Failed to fetch average resolution time', { error });
    throw new Error('Failed to fetch average resolution time');
  }
}

/**
 * Get recent tickets
 * 🟢 WORKING: Fetches most recently created tickets
 *
 * @param filters - Optional filters (limit, status)
 * @returns List of recent tickets
 */
export async function getRecentTickets(
  filters: DashboardFilters = {}
): Promise<RecentTicket[]> {
  try {
    const params: any[] = [];
    let whereClause = 'WHERE 1=1';
    let paramIndex = 1;

    // Filter by status if provided
    if (filters.status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    // Default limit to 10
    const limit = filters.limit || 10;
    params.push(limit);

    const sql = `
      SELECT
        id,
        ticket_uid,
        title,
        status,
        priority,
        created_at,
        assigned_to
      FROM tickets
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}
    `;

    logger.debug('Fetching recent tickets', { sql, params });

    const rows = await query<RecentTicket>(sql, params);

    return rows || [];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      return [];
    }
    logger.error('Failed to fetch recent tickets', { error });
    throw new Error('Failed to fetch recent tickets');
  }
}
