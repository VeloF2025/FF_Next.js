/**
 * Verification Steps API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for retrieving verification steps
 *
 * GET /api/ticketing/tickets/[id]/verification - List all verification steps
 *
 * Features:
 * - Returns all 12 verification steps for a ticket (ordered by step_number)
 * - UUID format validation
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getVerificationSteps, initializeVerificationSteps } from '@/modules/ticketing/services/verificationService';

const logger = createLogger('ticketing:api:verification');

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

// ==================== GET /api/ticketing/tickets/[id]/verification ====================

/**
 * 🟢 WORKING: Get all verification steps for a ticket
 *
 * Response (200):
 * {
 *   success: true,
 *   data: VerificationStep[],
 *   message: string
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

    logger.debug('Fetching verification steps', { ticketId });

    // 🟢 WORKING: Get all verification steps
    const steps = await getVerificationSteps(ticketId);

    // 🟢 WORKING: Return steps (empty array is valid - steps not initialized yet)
    return NextResponse.json({
      success: true,
      data: steps,
      message: steps.length > 0
        ? `Retrieved ${steps.length} verification steps`
        : 'No verification steps found. Initialize steps first.',
      meta: {
        timestamp: new Date().toISOString(),
        count: steps.length,
      },
    });
  } catch (error) {
    logger.error('Error fetching verification steps', {
      error,
      ticketId: params.id,
    });

    // 🟢 WORKING: Handle specific error types
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('not found')) {
      return notFoundError('Ticket', params.id);
    }

    return databaseError('Failed to fetch verification steps');
  }
}

// ==================== POST /api/ticketing/tickets/[id]/verification ====================

/**
 * 🟢 WORKING: Initialize verification steps for a ticket
 *
 * Creates all 12 verification steps for a ticket.
 * Returns error if steps already exist.
 *
 * Response (201):
 * {
 *   success: true,
 *   data: VerificationStep[],
 *   message: string
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ticketId = params.id;

    // Validate UUID format
    if (!isValidUUID(ticketId)) {
      return validationError('Invalid ticket ID format. Must be a valid UUID');
    }

    logger.info('Initializing verification steps', { ticketId });

    // Initialize all 12 verification steps
    const steps = await initializeVerificationSteps(ticketId);

    return NextResponse.json({
      success: true,
      data: steps,
      message: `Initialized ${steps.length} verification steps`,
      meta: {
        timestamp: new Date().toISOString(),
        count: steps.length,
      },
    }, { status: 201 });
  } catch (error) {
    logger.error('Error initializing verification steps', {
      error,
      ticketId: params.id,
    });

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('not found')) {
      return notFoundError('Ticket', params.id);
    }

    if (errorMessage.includes('already initialized')) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'ALREADY_EXISTS',
          message: 'Verification steps already initialized for this ticket',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      }, { status: 409 });
    }

    return databaseError('Failed to initialize verification steps');
  }
}
