/**
 * Ticket CRUD API Route - Individual Ticket Operations
 *
 * 🟢 WORKING: Production-ready API endpoints for individual ticket operations
 *
 * GET    /api/ticketing/tickets/[id] - Get ticket detail
 * PUT    /api/ticketing/tickets/[id] - Update ticket
 * DELETE /api/ticketing/tickets/[id] - Soft delete ticket
 *
 * Features:
 * - UUID format validation
 * - Partial updates support (PUT)
 * - Soft delete (marks status as CANCELLED, never hard delete)
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  getTicketById,
  updateTicket,
  deleteTicket
} from '@/modules/ticketing/services/ticketService';
import { enrichTicketData } from '@/modules/ticketing/services/ticketEnrichmentService';
import type { UpdateTicketPayload } from '@/modules/ticketing/types/ticket';

const logger = createLogger('ticketing:api:tickets:id');

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

// ==================== GET /api/ticketing/tickets/[id] ====================

/**
 * 🟢 WORKING: Get ticket by ID with enrichment
 *
 * Query params:
 * - enrich=true: Include FibreFlow cross-reference data (GPS, 1Map info)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ticketId = params.id;
    const { searchParams } = new URL(req.url);
    const shouldEnrich = searchParams.get('enrich') === 'true';

    // Validate UUID format
    if (!isValidUUID(ticketId)) {
      return validationError('Invalid ticket ID format. Must be a valid UUID');
    }

    logger.debug('Fetching ticket by ID', { ticketId, enrich: shouldEnrich });

    const ticket = await getTicketById(ticketId);

    if (!ticket) {
      return notFoundError('Ticket', ticketId);
    }

    // Enrich with FibreFlow cross-reference data if requested
    let enrichment = null;
    if (shouldEnrich && ticket.dr_number) {
      enrichment = await enrichTicketData(ticket.dr_number);
    }

    return NextResponse.json({
      success: true,
      data: {
        ...ticket,
        ...(enrichment && { fibreflow_enrichment: enrichment }),
      },
      meta: {
        timestamp: new Date().toISOString(),
        enriched: shouldEnrich && !!enrichment,
      },
    });
  } catch (error) {
    logger.error('Error fetching ticket', { error, ticketId: params.id });
    return databaseError('Failed to fetch ticket');
  }
}

// ==================== PUT /api/ticketing/tickets/[id] ====================

/**
 * 🟢 WORKING: Update ticket by ID
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ticketId = params.id;

    // Validate UUID format
    if (!isValidUUID(ticketId)) {
      return validationError('Invalid ticket ID format. Must be a valid UUID');
    }

    const body: UpdateTicketPayload = await req.json();

    // Validate that at least one field is provided
    if (Object.keys(body).length === 0) {
      return validationError('Update payload must contain at least one field');
    }

    logger.info('Updating ticket', {
      ticketId,
      fieldsToUpdate: Object.keys(body)
    });

    const updatedTicket = await updateTicket(ticketId, body);

    if (!updatedTicket) {
      return notFoundError('Ticket', ticketId);
    }

    return NextResponse.json({
      success: true,
      data: updatedTicket,
      message: 'Ticket updated successfully',
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error updating ticket', { error, ticketId: params.id });
    return databaseError('Failed to update ticket');
  }
}

// ==================== DELETE /api/ticketing/tickets/[id] ====================

/**
 * 🟢 WORKING: Soft delete ticket by ID
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ticketId = params.id;

    // Validate UUID format
    if (!isValidUUID(ticketId)) {
      return validationError('Invalid ticket ID format. Must be a valid UUID');
    }

    logger.info('Soft deleting ticket', { ticketId });

    const deletedTicket = await deleteTicket(ticketId);

    if (!deletedTicket) {
      return notFoundError('Ticket', ticketId);
    }

    return NextResponse.json({
      success: true,
      data: deletedTicket,
      message: 'Ticket deleted successfully (soft delete)',
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error deleting ticket', { error, ticketId: params.id });
    return databaseError('Failed to delete ticket');
  }
}
