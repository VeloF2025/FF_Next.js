/**
 * QA Readiness Service
 * 🟢 WORKING: Service to run QA readiness checks and record results
 *
 * Provides:
 * - Run QA readiness checks on tickets
 * - Record check results in qa_readiness_checks table
 * - Update ticket.qa_ready flag
 * - Get readiness status and history
 * - Prevent QA from starting on unready tickets
 *
 * Features:
 * - Validates all QA requirements before allowing QA to start
 * - Records detailed check results for audit trail
 * - Automatic system checks or manual checker tracking
 * - Historical tracking of all readiness checks
 */

import { query, queryOne } from '../utils/db';
import { validateQAReadiness } from '../utils/qaReadinessValidator';
import type { QAReadinessCheck, QAReadinessStatus } from '../types/verification';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ticketing:qaReadinessService');

/**
 * UUID validation regex
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format
 * 🟢 WORKING: UUID format validation
 */
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Run QA readiness check on a ticket
 * 🟢 WORKING: Validates ticket, runs checks, records results, updates qa_ready flag
 *
 * @param ticketId - Ticket UUID to check
 * @param checkedBy - User UUID who initiated check (null for system checks)
 * @returns QA readiness check record with results
 * @throws {Error} If ticket not found or validation fails
 */
export async function runReadinessCheck(
  ticketId: string,
  checkedBy?: string | null
): Promise<QAReadinessCheck> {
  // 🟢 WORKING: Validate ticket ID format
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }

  logger.info('Running QA readiness check', { ticketId, checkedBy });

  try {
    // 🟢 WORKING: Fetch ticket data
    const ticket = await queryOne<{
      id: string;
      ticket_uid: string;
      dr_number: string | null;
      pole_number: string | null;
      pon_number: string | null;
      zone_id: string | null;
      ont_serial: string | null;
      ont_rx_level: number | null;
    }>(
      `SELECT id, ticket_uid, dr_number, pole_number, pon_number, zone_id,
              ont_serial, ont_rx_level
       FROM tickets
       WHERE id = $1`,
      [ticketId]
    );

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // 🟢 WORKING: Get photo count for this ticket
    const photoResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM ticket_attachments
       WHERE ticket_id = $1 AND file_type = 'photo' AND is_evidence = true`,
      [ticketId]
    );

    const photosCount = photoResult?.count || 0;
    const photosRequiredCount = 3; // Standard requirement (could be configurable)

    // 🟢 WORKING: Run validation checks
    const validationResult = validateQAReadiness({
      ticket_id: ticketId,
      photos_count: photosCount,
      photos_required_count: photosRequiredCount,
      dr_number: ticket.dr_number,
      pole_number: ticket.pole_number,
      pon_number: ticket.pon_number,
      zone_id: ticket.zone_id,
      ont_serial: ticket.ont_serial,
      ont_rx_level: ticket.ont_rx_level,
      // platforms_data is optional - could be added for cross-platform validation
    });

    logger.info('Validation result', {
      ticketId,
      passed: validationResult.passed,
      failedChecksCount: validationResult.failed_checks.length,
    });

    // 🟢 WORKING: Insert check record into qa_readiness_checks
    const checkRecord = await queryOne<QAReadinessCheck>(
      `INSERT INTO qa_readiness_checks (
        ticket_id,
        passed,
        checked_by,
        photos_exist,
        photos_count,
        photos_required_count,
        dr_populated,
        pole_populated,
        pon_populated,
        zone_populated,
        ont_serial_recorded,
        ont_rx_recorded,
        platforms_aligned,
        failed_checks
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        ticketId,
        validationResult.passed,
        checkedBy || null,
        validationResult.photos_exist,
        validationResult.photos_count,
        validationResult.photos_required_count,
        validationResult.dr_populated,
        validationResult.pole_populated,
        validationResult.pon_populated,
        validationResult.zone_populated,
        validationResult.ont_serial_recorded,
        validationResult.ont_rx_recorded,
        validationResult.platforms_aligned,
        JSON.stringify(validationResult.failed_checks),
      ]
    );

    if (!checkRecord) {
      throw new Error('Failed to create readiness check record');
    }

    // 🟢 WORKING: Update ticket.qa_ready flag and timestamp
    await query(
      `UPDATE tickets
       SET qa_ready = $1,
           qa_readiness_check_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [validationResult.passed, ticketId]
    );

    logger.info('QA readiness check completed', {
      ticketId,
      checkId: checkRecord.id,
      passed: validationResult.passed,
    });

    return checkRecord;
  } catch (error) {
    logger.error('Failed to run QA readiness check', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get current QA readiness status for a ticket
 * 🟢 WORKING: Returns latest readiness check status
 *
 * @param ticketId - Ticket UUID
 * @returns Current readiness status with latest check details
 * @throws {Error} If ticket ID format is invalid
 */
export async function getReadinessStatus(ticketId: string): Promise<QAReadinessStatus> {
  // 🟢 WORKING: Validate ticket ID format
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }

  logger.debug('Getting readiness status', { ticketId });

  try {
    // 🟢 WORKING: Get latest readiness check
    const latestCheck = await queryOne<QAReadinessCheck>(
      `SELECT * FROM qa_readiness_checks
       WHERE ticket_id = $1
       ORDER BY checked_at DESC
       LIMIT 1`,
      [ticketId]
    );

    if (!latestCheck) {
      // No checks run yet
      return {
        ticket_id: ticketId,
        is_ready: false,
        last_check: null,
        last_check_at: null,
        failed_reasons: null,
        next_action: 'Run readiness check first',
      };
    }

    // 🟢 WORKING: Extract failed reasons from failed_checks
    const failedReasons =
      latestCheck.failed_checks && Array.isArray(latestCheck.failed_checks)
        ? latestCheck.failed_checks.map((check) => check.reason)
        : null;

    return {
      ticket_id: ticketId,
      is_ready: latestCheck.passed,
      last_check: latestCheck,
      last_check_at: latestCheck.checked_at,
      failed_reasons: failedReasons,
      next_action: latestCheck.passed ? 'Ticket is ready for QA' : 'Fix failed checks before QA',
    };
  } catch (error) {
    logger.error('Failed to get readiness status', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get full readiness check history for a ticket
 * 🟢 WORKING: Returns all readiness checks ordered by date (newest first)
 *
 * @param ticketId - Ticket UUID
 * @returns Array of all readiness checks
 * @throws {Error} If ticket ID format is invalid
 */
export async function getReadinessHistory(ticketId: string): Promise<QAReadinessCheck[]> {
  // 🟢 WORKING: Validate ticket ID format
  if (!isValidUUID(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }

  logger.debug('Getting readiness history', { ticketId });

  try {
    // 🟢 WORKING: Get all checks for ticket
    const checks = await query<QAReadinessCheck>(
      `SELECT * FROM qa_readiness_checks
       WHERE ticket_id = $1
       ORDER BY checked_at DESC`,
      [ticketId]
    );

    return checks;
  } catch (error) {
    logger.error('Failed to get readiness history', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Check if QA can be started on a ticket
 * 🟢 WORKING: Returns true if latest check passed, false otherwise
 *
 * @param ticketId - Ticket UUID
 * @returns True if QA can start, false if not ready or no checks run
 * @throws {Error} If ticket ID format is invalid
 */
export async function canStartQA(ticketId: string): Promise<boolean> {
  logger.debug('Checking if QA can start', { ticketId });

  try {
    const status = await getReadinessStatus(ticketId);
    return status.is_ready;
  } catch (error) {
    logger.error('Failed to check if QA can start', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
