/**
 * Risk Acceptance Service
 *
 * 🟢 WORKING: Production-ready risk acceptance service for QA conditional approvals
 *
 * Provides:
 * - Create risk acceptance with conditions and expiry tracking
 * - List active risks for tickets
 * - Resolve risk acceptances
 * - Get expiring risks (within configurable days)
 * - Escalate expired risks
 * - Check if ticket can be closed (no active unresolved risks)
 * - Get comprehensive risk summary for tickets
 *
 * Features:
 * - Input validation
 * - SQL injection prevention (parameterized queries)
 * - Automatic expiry tracking
 * - Escalation workflow for expired risks
 * - Ticket closure validation
 */

import { query, queryOne } from '../utils/db';
import {
  QARiskAcceptance,
  CreateRiskAcceptancePayload,
  ResolveRiskAcceptancePayload,
  RiskType,
  RiskAcceptanceStatus,
  TicketRiskSummary
} from '../types/riskAcceptance';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ticketing:risk-acceptance');

/**
 * UUID validation regex
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format
 */
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Validate risk type enum
 */
function isValidRiskType(riskType: string): riskType is RiskType {
  return Object.values(RiskType).includes(riskType as RiskType);
}

/**
 * Create a new risk acceptance record
 *
 * @param payload - Risk acceptance creation data
 * @returns Created risk acceptance with generated ID
 * @throws {Error} If validation fails or database error occurs
 */
export async function createRiskAcceptance(
  payload: CreateRiskAcceptancePayload
): Promise<QARiskAcceptance> {
  // 🟢 WORKING: Validate required fields
  if (!payload.ticket_id) {
    throw new Error('ticket_id is required');
  }

  if (!payload.risk_type) {
    throw new Error('risk_type is required');
  }

  if (!payload.risk_description || !payload.risk_description.trim()) {
    throw new Error(
      payload.risk_description === ''
        ? 'risk_description cannot be empty'
        : 'risk_description is required'
    );
  }

  if (!payload.accepted_by) {
    throw new Error('accepted_by is required');
  }

  // 🟢 WORKING: Validate enum value
  if (!isValidRiskType(payload.risk_type)) {
    throw new Error('Invalid risk_type value');
  }

  logger.info('Creating risk acceptance', {
    ticket_id: payload.ticket_id,
    risk_type: payload.risk_type,
    has_expiry: !!payload.risk_expiry_date
  });

  try {
    // 🟢 WORKING: Insert risk acceptance with all fields
    const sql = `
      INSERT INTO qa_risk_acceptances (
        ticket_id,
        risk_type,
        risk_description,
        conditions,
        risk_expiry_date,
        requires_followup,
        followup_date,
        accepted_by,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      payload.ticket_id,
      payload.risk_type,
      payload.risk_description,
      payload.conditions || null,
      payload.risk_expiry_date || null,
      payload.requires_followup !== undefined ? payload.requires_followup : true,
      payload.followup_date || null,
      payload.accepted_by,
      RiskAcceptanceStatus.ACTIVE
    ];

    const result = await queryOne<QARiskAcceptance>(sql, values);

    if (!result) {
      throw new Error('Failed to create risk acceptance');
    }

    logger.info('Risk acceptance created successfully', {
      risk_id: result.id,
      ticket_id: result.ticket_id
    });

    return result;
  } catch (error) {
    logger.error('Failed to create risk acceptance', {
      error: error instanceof Error ? error.message : 'Unknown error',
      ticket_id: payload.ticket_id
    });
    throw error;
  }
}

/**
 * Get risk acceptance by ID
 *
 * @param riskId - Risk acceptance UUID
 * @returns Risk acceptance record
 * @throws {Error} If risk not found or invalid ID format
 */
export async function getRiskAcceptanceById(riskId: string): Promise<QARiskAcceptance> {
  // 🟢 WORKING: Validate UUID format
  if (!isValidUUID(riskId)) {
    throw new Error('Invalid risk acceptance ID format');
  }

  logger.debug('Fetching risk acceptance by ID', { risk_id: riskId });

  try {
    const sql = 'SELECT * FROM qa_risk_acceptances WHERE id = $1';
    const result = await queryOne<QARiskAcceptance>(sql, [riskId]);

    if (!result) {
      throw new Error('Risk acceptance not found');
    }

    return result;
  } catch (error) {
    logger.error('Failed to fetch risk acceptance', {
      error: error instanceof Error ? error.message : 'Unknown error',
      risk_id: riskId
    });
    throw error;
  }
}

/**
 * List all risks for a ticket (defaults to active status)
 *
 * @param ticketId - Ticket UUID
 * @param status - Optional status filter (defaults to ACTIVE)
 * @returns Array of risk acceptances
 */
export async function listRisksForTicket(
  ticketId: string,
  status: RiskAcceptanceStatus = RiskAcceptanceStatus.ACTIVE
): Promise<QARiskAcceptance[]> {
  logger.debug('Listing risks for ticket', {
    ticket_id: ticketId,
    status
  });

  try {
    const sql = `
      SELECT * FROM qa_risk_acceptances
      WHERE ticket_id = $1 AND status = $2
      ORDER BY created_at DESC
    `;

    const results = await query<QARiskAcceptance>(sql, [ticketId, status]);

    logger.debug('Found risks for ticket', {
      ticket_id: ticketId,
      count: results.length
    });

    return results;
  } catch (error) {
    logger.error('Failed to list risks for ticket', {
      error: error instanceof Error ? error.message : 'Unknown error',
      ticket_id: ticketId
    });
    throw error;
  }
}

/**
 * Resolve a risk acceptance
 *
 * @param riskId - Risk acceptance UUID
 * @param payload - Resolution data (resolved_by and resolution_notes)
 * @returns Updated risk acceptance
 * @throws {Error} If validation fails or risk not found
 */
export async function resolveRiskAcceptance(
  riskId: string,
  payload: ResolveRiskAcceptancePayload
): Promise<QARiskAcceptance> {
  // 🟢 WORKING: Validate required fields
  if (!payload.resolved_by) {
    throw new Error('resolved_by is required');
  }

  if (!payload.resolution_notes || !payload.resolution_notes.trim()) {
    throw new Error(
      payload.resolution_notes === ''
        ? 'resolution_notes cannot be empty'
        : 'resolution_notes is required'
    );
  }

  logger.info('Resolving risk acceptance', {
    risk_id: riskId,
    resolved_by: payload.resolved_by
  });

  try {
    const sql = `
      UPDATE qa_risk_acceptances
      SET
        status = $1,
        resolved_at = NOW(),
        resolved_by = $2,
        resolution_notes = $3
      WHERE id = $4
      RETURNING *
    `;

    const values = [
      RiskAcceptanceStatus.RESOLVED,
      payload.resolved_by,
      payload.resolution_notes,
      riskId
    ];

    const result = await queryOne<QARiskAcceptance>(sql, values);

    if (!result) {
      throw new Error('Risk acceptance not found');
    }

    logger.info('Risk acceptance resolved successfully', {
      risk_id: riskId,
      ticket_id: result.ticket_id
    });

    return result;
  } catch (error) {
    logger.error('Failed to resolve risk acceptance', {
      error: error instanceof Error ? error.message : 'Unknown error',
      risk_id: riskId
    });
    throw error;
  }
}

/**
 * Get risks expiring within specified days
 *
 * @param days - Number of days to look ahead (default: 7)
 * @param referenceDate - Reference date for calculation (default: today)
 * @returns Array of risks expiring soon
 */
export async function getExpiringRisks(
  days: number = 7,
  referenceDate: Date = new Date()
): Promise<QARiskAcceptance[]> {
  const expiryDate = new Date(referenceDate);
  expiryDate.setDate(expiryDate.getDate() + days);

  logger.debug('Finding expiring risks', {
    days,
    reference_date: referenceDate.toISOString(),
    expiry_date: expiryDate.toISOString()
  });

  try {
    const sql = `
      SELECT * FROM qa_risk_acceptances
      WHERE status = $1
        AND risk_expiry_date IS NOT NULL
        AND risk_expiry_date <= $2
      ORDER BY risk_expiry_date ASC
    `;

    const results = await query<QARiskAcceptance>(sql, [
      RiskAcceptanceStatus.ACTIVE,
      expiryDate
    ]);

    logger.info('Found expiring risks', {
      count: results.length,
      within_days: days
    });

    return results;
  } catch (error) {
    logger.error('Failed to get expiring risks', {
      error: error instanceof Error ? error.message : 'Unknown error',
      days
    });
    throw error;
  }
}

/**
 * Escalate expired risks
 * First marks active risks past expiry date as EXPIRED,
 * then escalates all EXPIRED risks to ESCALATED status
 *
 * @param referenceDate - Reference date for expiry check (default: today)
 * @returns Object with count of escalated risks and their details
 */
export async function escalateExpiredRisks(
  referenceDate: Date = new Date()
): Promise<{ escalatedCount: number; escalatedRisks: QARiskAcceptance[] }> {
  logger.info('Starting expired risk escalation', {
    reference_date: referenceDate.toISOString()
  });

  try {
    // 🟢 WORKING: Step 1 - Mark active risks as EXPIRED if past expiry date
    const markExpiredSql = `
      UPDATE qa_risk_acceptances
      SET status = $1
      WHERE status = $2
        AND risk_expiry_date IS NOT NULL
        AND risk_expiry_date < $3
      RETURNING *
    `;

    await query<QARiskAcceptance>(markExpiredSql, [
      RiskAcceptanceStatus.EXPIRED,
      RiskAcceptanceStatus.ACTIVE,
      referenceDate
    ]);

    // 🟢 WORKING: Step 2 - Get all EXPIRED risks
    const findExpiredSql = `
      SELECT * FROM qa_risk_acceptances
      WHERE status = $1
      ORDER BY risk_expiry_date ASC
    `;

    const expiredRisks = await query<QARiskAcceptance>(findExpiredSql, [
      RiskAcceptanceStatus.EXPIRED
    ]);

    if (expiredRisks.length === 0) {
      logger.info('No expired risks to escalate');
      return { escalatedCount: 0, escalatedRisks: [] };
    }

    // 🟢 WORKING: Step 3 - Escalate all EXPIRED risks to ESCALATED
    const riskIds = expiredRisks.map(r => r.id);
    const escalateSql = `
      UPDATE qa_risk_acceptances
      SET status = $1
      WHERE id = ANY($2::uuid[])
    `;

    await query(escalateSql, [RiskAcceptanceStatus.ESCALATED, riskIds]);

    logger.info('Escalated expired risks', {
      count: expiredRisks.length
    });

    return {
      escalatedCount: expiredRisks.length,
      escalatedRisks: expiredRisks
    };
  } catch (error) {
    logger.error('Failed to escalate expired risks', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Check if a ticket can be closed
 * Returns true only if there are NO active unresolved risks
 *
 * @param ticketId - Ticket UUID
 * @returns true if ticket can be closed, false otherwise
 */
export async function canCloseTicket(ticketId: string): Promise<boolean> {
  logger.debug('Checking if ticket can be closed', { ticket_id: ticketId });

  try {
    const sql = `
      SELECT * FROM qa_risk_acceptances
      WHERE ticket_id = $1 AND status = $2
    `;

    const activeRisks = await query<QARiskAcceptance>(sql, [
      ticketId,
      RiskAcceptanceStatus.ACTIVE
    ]);

    const canClose = activeRisks.length === 0;

    logger.info('Ticket closure check result', {
      ticket_id: ticketId,
      can_close: canClose,
      active_risks_count: activeRisks.length
    });

    return canClose;
  } catch (error) {
    logger.error('Failed to check ticket closure eligibility', {
      error: error instanceof Error ? error.message : 'Unknown error',
      ticket_id: ticketId
    });
    throw error;
  }
}

/**
 * Get comprehensive risk summary for a ticket
 *
 * @param ticketId - Ticket UUID
 * @returns Risk summary with counts and status breakdown
 */
/**
 * List all risk acceptances with optional filters
 * Used for the global Risk Acceptance Review page
 *
 * @param filters - Optional filters (status, expiring_within_days, project_id)
 * @param limit - Pagination limit (default: 50)
 * @param offset - Pagination offset (default: 0)
 * @returns Array of risk acceptances with ticket info
 */
export async function listAllRiskAcceptances(
  filters: {
    status?: RiskAcceptanceStatus | RiskAcceptanceStatus[];
    expiring_within_days?: number;
    project_id?: string;
  } = {},
  limit: number = 50,
  offset: number = 0
): Promise<{ risks: (QARiskAcceptance & { ticket_uid?: string; ticket_title?: string; project_name?: string })[]; total: number }> {
  logger.debug('Listing all risk acceptances', { filters, limit, offset });

  try {
    // Build dynamic WHERE clauses
    const conditions: string[] = [];
    const values: (string | number | Date | string[])[] = [];
    let paramIndex = 1;

    // Status filter (can be single or array)
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(`r.status = ANY($${paramIndex}::text[])`);
        values.push(filters.status);
      } else {
        conditions.push(`r.status = $${paramIndex}`);
        values.push(filters.status);
      }
      paramIndex++;
    }

    // Expiring within days filter
    if (filters.expiring_within_days !== undefined) {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + filters.expiring_within_days);
      conditions.push(`r.status = 'active' AND r.risk_expiry_date IS NOT NULL AND r.risk_expiry_date <= $${paramIndex}`);
      values.push(expiryDate);
      paramIndex++;
    }

    // Project filter
    if (filters.project_id) {
      conditions.push(`t.project_id = $${paramIndex}`);
      values.push(filters.project_id);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countSql = `
      SELECT COUNT(*) as total
      FROM qa_risk_acceptances r
      LEFT JOIN tickets t ON r.ticket_id = t.id
      ${whereClause}
    `;
    const countResult = await queryOne<{ total: string }>(countSql, values);
    const total = parseInt(countResult?.total || '0', 10);

    // Fetch risks with ticket info
    // Note: tickets.project_id is TEXT, projects.id is UUID - need cast
    const sql = `
      SELECT
        r.*,
        t.ticket_uid,
        t.title as ticket_title,
        p.project_name
      FROM qa_risk_acceptances r
      LEFT JOIN tickets t ON r.ticket_id = t.id
      LEFT JOIN projects p ON t.project_id::uuid = p.id
      ${whereClause}
      ORDER BY
        CASE r.status
          WHEN 'active' THEN 1
          WHEN 'expired' THEN 2
          WHEN 'escalated' THEN 3
          WHEN 'resolved' THEN 4
        END,
        r.risk_expiry_date ASC NULLS LAST,
        r.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    values.push(limit, offset);
    const risks = await query<QARiskAcceptance & { ticket_uid?: string; ticket_title?: string; project_name?: string }>(sql, values);

    logger.info('Listed all risk acceptances', {
      total,
      returned: risks.length,
      filters
    });

    return { risks, total };
  } catch (error) {
    logger.error('Failed to list all risk acceptances', {
      error: error instanceof Error ? error.message : 'Unknown error',
      filters
    });
    throw error;
  }
}

/**
 * Get comprehensive risk summary for a ticket
 *
 * @param ticketId - Ticket UUID
 * @returns Risk summary with counts and status breakdown
 */
export async function getTicketRiskSummary(ticketId: string): Promise<TicketRiskSummary> {
  logger.debug('Getting risk summary for ticket', { ticket_id: ticketId });

  try {
    // 🟢 WORKING: Fetch all risks for the ticket
    const sql = `
      SELECT * FROM qa_risk_acceptances
      WHERE ticket_id = $1
      ORDER BY created_at DESC
    `;

    const risks = await query<QARiskAcceptance>(sql, [ticketId]);

    // 🟢 WORKING: Calculate summary statistics
    const summary: TicketRiskSummary = {
      ticket_id: ticketId,
      total_risks: risks.length,
      active_risks: risks.filter(r => r.status === RiskAcceptanceStatus.ACTIVE).length,
      resolved_risks: risks.filter(r => r.status === RiskAcceptanceStatus.RESOLVED).length,
      expired_risks: risks.filter(r => r.status === RiskAcceptanceStatus.EXPIRED).length,
      escalated_risks: risks.filter(r => r.status === RiskAcceptanceStatus.ESCALATED).length,
      has_blocking_risks: risks.some(r => r.status === RiskAcceptanceStatus.ACTIVE),
      can_close_ticket: !risks.some(r => r.status === RiskAcceptanceStatus.ACTIVE),
      risks
    };

    logger.debug('Risk summary calculated', {
      ticket_id: ticketId,
      total: summary.total_risks,
      active: summary.active_risks,
      can_close: summary.can_close_ticket
    });

    return summary;
  } catch (error) {
    logger.error('Failed to get risk summary', {
      error: error instanceof Error ? error.message : 'Unknown error',
      ticket_id: ticketId
    });
    throw error;
  }
}
