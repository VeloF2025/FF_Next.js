/**
 * Handover History API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for retrieving handover history
 *
 * GET /api/ticketing/tickets/[id]/handover-history - Get handover history
 *
 * Features:
 * - Retrieve all handover snapshots for a ticket
 * - Show current ownership status
 * - Show full audit trail of ownership transfers
 * - Validate UUID formats
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getHandoverHistory } from '@/modules/ticketing/services/handoverService';

const logger = createLogger('ticketing:api:handover-history');

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
function notFoundError(message: string) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message,
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

// ==================== GET /api/ticketing/tickets/[id]/handover-history ====================

/**
 * 🟢 WORKING: Get handover history for a ticket
 *
 * Returns all handover snapshots for the ticket, showing:
 * - Full handover audit trail
 * - Current ownership status
 * - All ownership transfers
 * - Complete snapshot data for each handover
 *
 * Response (200):
 * {
 *   success: true,
 *   data: {
 *     ticket_id: string,
 *     ticket_uid: string,
 *     handovers: HandoverSnapshot[],
 *     total_handovers: number,
 *     current_owner_type: string | null,
 *     current_owner_id: string | null
 *   },
 *   meta: {
 *     timestamp: string
 *   }
 * }
 *
 * Error responses:
 * - 422: Validation error (invalid ticket ID format)
 * - 404: Ticket not found
 * - 500: Database error
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ticketId = params.id;

    // 🟢 WORKING: Validate ticket ID format
    if (!isValidUUID(ticketId)) {
      return validationError('Invalid ticket ID format. Must be a valid UUID');
    }

    logger.debug('Fetching handover history', {
      ticketId,
    });

    // 🟢 WORKING: Get handover history from service
    const history = await getHandoverHistory(ticketId);

    logger.debug('Handover history retrieved', {
      ticketId,
      totalHandovers: history.total_handovers,
      currentOwner: history.current_owner_type,
    });

    return NextResponse.json(
      {
        success: true,
        data: history,
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Error fetching handover history', {
      error,
      ticketId: params.id,
    });

    // 🟢 WORKING: Handle specific error types
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for "not found" errors
    if (errorMessage.toLowerCase().includes('not found')) {
      return notFoundError(errorMessage);
    }

    // Default to database error
    return databaseError('Failed to fetch handover history');
  }
}
