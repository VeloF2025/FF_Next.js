/**
 * Verification Complete API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for checking verification completion status
 *
 * POST /api/ticketing/tickets/[id]/verification/complete - Get verification progress
 *
 * Features:
 * - Returns complete verification progress (completed/total, percentage)
 * - Calculates progress summary
 * - Includes all verification steps with completion status
 * - Indicates if all steps are complete
 * - UUID format validation
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 *
 * Note: This endpoint returns progress information. It does NOT automatically
 * complete all steps. Steps must be individually marked complete via PUT endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { calculateProgress } from '@/modules/ticketing/services/verificationService';

const logger = createLogger('ticketing:api:verification:complete');

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

// ==================== POST /api/ticketing/tickets/[id]/verification/complete ====================

/**
 * 🟢 WORKING: Get verification progress and completion status
 *
 * Response (200):
 * {
 *   success: true,
 *   data: VerificationProgress,
 *   message: string
 * }
 *
 * VerificationProgress includes:
 * - ticket_id
 * - total_steps (always 12)
 * - completed_steps
 * - pending_steps
 * - progress_percentage
 * - all_steps_complete (boolean)
 * - steps (array of all VerificationStep objects)
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

    logger.info('Calculating verification progress', { ticketId });

    // 🟢 WORKING: Calculate progress
    const progress = await calculateProgress(ticketId);

    // 🟢 WORKING: Determine response message based on completion status
    const message = progress.all_steps_complete
      ? `All verification steps completed successfully (${progress.completed_steps}/${progress.total_steps})`
      : `Verification progress: ${progress.completed_steps}/${progress.total_steps} steps completed (${progress.progress_percentage}%). ${progress.pending_steps} steps remaining.`;

    return NextResponse.json({
      success: true,
      data: progress,
      message,
      meta: {
        timestamp: new Date().toISOString(),
        completion_status: progress.all_steps_complete ? 'complete' : 'in_progress',
      },
    });
  } catch (error) {
    logger.error('Error calculating verification progress', {
      error,
      ticketId: params.id,
    });

    // 🟢 WORKING: Handle specific error types
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes('not found') ||
      errorMessage.includes('No verification steps found')
    ) {
      return notFoundError('Verification steps', params.id);
    }

    return databaseError('Failed to calculate verification progress');
  }
}
