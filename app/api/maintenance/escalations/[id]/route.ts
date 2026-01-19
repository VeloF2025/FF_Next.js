/**
 * Escalation Detail API Route
 * 🟢 WORKING: Production-ready API endpoint for individual escalation operations
 *
 * GET /api/ticketing/escalations/[id] - Get escalation detail
 *
 * Features:
 * - UUID format validation
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getEscalationById } from '@/modules/ticketing/services/escalationService';

const logger = createLogger('ticketing:api:escalations:id');

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
 * Validation error response
 */
function validationError(message: string, details?: any) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message,
        ...(details && { details }),
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

// ==================== GET /api/ticketing/escalations/[id] ====================

/**
 * 🟢 WORKING: Get escalation by ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const escalationId = params.id;

    // Validate UUID format
    if (!isValidUUID(escalationId)) {
      return validationError('Invalid escalation ID format. Must be a valid UUID');
    }

    logger.debug('Fetching escalation by ID', { escalationId });

    const escalation = await getEscalationById(escalationId);

    if (!escalation) {
      return notFoundError('Escalation', escalationId);
    }

    return NextResponse.json({
      success: true,
      data: escalation,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    // Handle specific error cases
    if (error instanceof Error) {
      if (error.message === 'Escalation not found') {
        return notFoundError('Escalation', params.id);
      }
      if (error.message === 'Invalid escalation ID format') {
        return validationError(error.message);
      }
    }

    logger.error('Error fetching escalation', { error, escalationId: params.id });
    return databaseError('Failed to fetch escalation');
  }
}
