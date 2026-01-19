/**
 * QA Readiness Status API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for viewing QA readiness status
 *
 * GET /api/ticketing/tickets/[id]/qa-readiness - Get current QA readiness status
 *
 * Features:
 * - Returns current readiness status (is_ready: true/false)
 * - Shows latest check results with timestamp
 * - Lists failed reasons if not ready
 * - Provides next action guidance
 * - Returns graceful response when no checks have been run
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getReadinessStatus } from '@/modules/ticketing/services/qaReadinessService';

const logger = createLogger('ticketing:api:qa-readiness');

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

// ==================== GET /api/ticketing/tickets/[id]/qa-readiness ====================

/**
 * 🟢 WORKING: Get current QA readiness status for a ticket
 *
 * Response (200):
 * {
 *   success: true,
 *   data: {
 *     ticket_id: string,
 *     is_ready: boolean,
 *     last_check: QAReadinessCheck | null,
 *     last_check_at: Date | null,
 *     failed_reasons: string[] | null,
 *     next_action: string
 *   }
 * }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ticketId = params.id;

    // 🟢 WORKING: Validate UUID format
    if (!isValidUUID(ticketId)) {
      return validationError('Invalid ticket ID format. Must be a valid UUID');
    }

    logger.debug('Fetching QA readiness status', { ticketId });

    // 🟢 WORKING: Get readiness status from service
    const status = await getReadinessStatus(ticketId);

    return NextResponse.json({
      success: true,
      data: status,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error fetching QA readiness status', {
      error,
      ticketId: params.id,
    });

    return databaseError('Failed to fetch QA readiness status');
  }
}
