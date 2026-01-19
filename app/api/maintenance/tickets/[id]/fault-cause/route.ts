/**
 * Fault Cause API Route - Set Fault Cause for Ticket
 *
 * 🟢 WORKING: Production-ready API endpoint for fault cause classification
 *
 * PUT /api/ticketing/tickets/[id]/fault-cause - Set fault cause and optional details
 *
 * Features:
 * - Fault cause enum validation (7 valid causes)
 * - Optional fault_cause_details field
 * - UUID format validation
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  updateTicket,
  getTicketById,
} from '@/modules/ticketing/services/ticketService';
import { FaultCause } from '@/modules/ticketing/types/ticket';

const logger = createLogger('ticketing:api:fault-cause');

/**
 * UUID validation regex
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valid fault cause values
 */
const VALID_FAULT_CAUSES = Object.values(FaultCause);

/**
 * Validate UUID format
 */
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Validate fault cause enum value
 */
function isValidFaultCause(cause: any): cause is FaultCause {
  return typeof cause === 'string' && VALID_FAULT_CAUSES.includes(cause as FaultCause);
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

// ==================== PUT /api/ticketing/tickets/[id]/fault-cause ====================

/**
 * PUT handler - Set fault cause for ticket
 * 🟢 WORKING: Updates fault_cause and optional fault_cause_details
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { id } = params;

    // Validate UUID format
    if (!isValidUUID(id)) {
      logger.warn('Invalid UUID format', { id });
      return validationError('Invalid ticket ID format. Must be a valid UUID.');
    }

    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      logger.warn('Invalid JSON in request body', { error });
      return validationError('Invalid JSON in request body');
    }

    const { fault_cause, fault_cause_details } = body;

    // Validate required field: fault_cause
    if (!fault_cause) {
      logger.warn('Missing fault_cause field', { id });
      return validationError('fault_cause is required');
    }

    // Validate fault_cause enum value
    if (!isValidFaultCause(fault_cause)) {
      logger.warn('Invalid fault_cause value', { id, fault_cause });
      return validationError(
        `Invalid fault_cause. Must be one of: ${VALID_FAULT_CAUSES.join(', ')}`,
        { valid_values: VALID_FAULT_CAUSES }
      );
    }

    // Validate fault_cause_details if provided (optional)
    if (fault_cause_details !== undefined && fault_cause_details !== null && typeof fault_cause_details !== 'string') {
      logger.warn('Invalid fault_cause_details type', { id, type: typeof fault_cause_details });
      return validationError('fault_cause_details must be a string if provided');
    }

    // Update ticket with fault cause
    logger.info('Updating ticket fault cause', { id, fault_cause, has_details: !!fault_cause_details });

    const updatedTicket = await updateTicket(id, {
      fault_cause: fault_cause as FaultCause,
      ...(fault_cause_details !== undefined && { fault_cause_details }),
    });

    // Check if ticket was found
    if (!updatedTicket) {
      logger.warn('Ticket not found for fault cause update', { id });
      return notFoundError('Ticket', id);
    }

    logger.info('Successfully updated ticket fault cause', {
      id,
      ticket_uid: updatedTicket.ticket_uid,
      fault_cause: updatedTicket.fault_cause,
    });

    return NextResponse.json(
      {
        success: true,
        data: updatedTicket,
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Error updating ticket fault cause', {
      error: error instanceof Error ? error.message : String(error),
      id: params.id,
    });

    return databaseError(
      process.env.NODE_ENV === 'development'
        ? `Failed to update ticket fault cause: ${error instanceof Error ? error.message : String(error)}`
        : 'Failed to update ticket fault cause'
    );
  }
}
