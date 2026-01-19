/**
 * QA Readiness Check API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for running QA readiness checks
 *
 * POST /api/ticketing/tickets/[id]/qa-readiness-check - Run QA readiness check
 *
 * Features:
 * - Runs all QA readiness validations
 * - Records check results in database
 * - Updates ticket.qa_ready flag
 * - Returns detailed check results with pass/fail status
 * - Optional checked_by parameter for manual checks
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { runReadinessCheck } from '@/modules/ticketing/services/qaReadinessService';

const logger = createLogger('ticketing:api:qa-readiness-check');

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
 * Validation error response
 * 🟢 WORKING: Standard validation error response
 */
function validationError(message: string) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    },
    { status: 422 }
  );
}

/**
 * Not found error response
 * 🟢 WORKING: Standard not found error response
 */
function notFoundError(resource: string, identifier: string) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `${resource} with ID '${identifier}' not found`,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    },
    { status: 404 }
  );
}

/**
 * Database error response
 * 🟢 WORKING: Standard database error response
 */
function databaseError(message: string) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    },
    { status: 500 }
  );
}

// ==================== POST /api/ticketing/tickets/[id]/qa-readiness-check ====================

/**
 * 🟢 WORKING: Run QA readiness check on a ticket
 *
 * Request body (optional):
 * {
 *   checked_by?: string  // UUID of user running check, null for system checks
 * }
 *
 * Response (200):
 * {
 *   success: true,
 *   data: QAReadinessCheck,
 *   message: string
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ticketId = params.id;

    // 🟢 WORKING: Validate UUID format
    if (!isValidUUID(ticketId)) {
      return validationError('Invalid ticket ID format. Must be a valid UUID');
    }

    // 🟢 WORKING: Parse request body (optional checked_by field)
    let checkedBy: string | null = null;
    try {
      const body = await req.json();
      checkedBy = body.checked_by || null;

      // Validate checked_by if provided
      if (checkedBy && !isValidUUID(checkedBy)) {
        return validationError('Invalid checked_by ID format. Must be a valid UUID');
      }
    } catch (error) {
      // Empty body is OK - default to system check (checked_by = null)
      checkedBy = null;
    }

    logger.info('Running QA readiness check', { ticketId, checkedBy });

    // 🟢 WORKING: Run the readiness check
    const checkResult = await runReadinessCheck(ticketId, checkedBy);

    // 🟢 WORKING: Determine response message based on check result
    const message = checkResult.passed
      ? 'QA readiness check completed. Ticket is ready for QA.'
      : `QA readiness check completed. Ticket is not ready for QA. ${checkResult.failed_checks?.length || 0} checks failed.`;

    return NextResponse.json({
      success: true,
      data: checkResult,
      message,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error running QA readiness check', {
      error,
      ticketId: params.id,
    });

    // 🟢 WORKING: Handle specific error types
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('not found')) {
      return notFoundError('Ticket', params.id);
    }

    return databaseError('Failed to run QA readiness check');
  }
}
