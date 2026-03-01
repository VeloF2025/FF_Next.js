/**
 * Ticket CRUD API Route - Individual Ticket Operations
 *
 * 🟢 WORKING: Production-ready API endpoints for individual ticket operations
 *
 * GET    /api/maintenance/tickets/[id] - Get ticket detail
 * PUT    /api/maintenance/tickets/[id] - Update ticket
 * DELETE /api/maintenance/tickets/[id] - Soft delete ticket
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
} from '@/modules/maintenance/services/ticketService';
import { enrichTicketData } from '@/modules/maintenance/services/ticketEnrichmentService';
import { syncOutboundUpdate } from '@/modules/maintenance/services/qcontactSyncOutbound';
import {
  triggerOnTicketAssignment,
  triggerOnTeamAssignment,
} from '@/modules/maintenance/services/notificationTriggers';
import type { UpdateTicketPayload } from '@/modules/maintenance/types/ticket';
import { TicketStatus } from '@/modules/maintenance/types/ticket';

const logger = createLogger('maintenance:api:tickets:id');

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

// ==================== GET /api/maintenance/tickets/[id] ====================

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

// ==================== PUT /api/maintenance/tickets/[id] ====================

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

    // Capture old state for assignment-change detection
    const oldTicket = await getTicketById(ticketId);

    const updatedTicket = await updateTicket(ticketId, body);

    if (!updatedTicket) {
      return notFoundError('Ticket', ticketId);
    }

    // Sync changes to QContact in real-time (async, non-blocking)
    const outboundChanges: { status?: TicketStatus; assigned_to?: string | null } = {};
    if (body.status) outboundChanges.status = body.status as TicketStatus;
    if (body.assigned_to !== undefined) outboundChanges.assigned_to = body.assigned_to ?? null;

    if (Object.keys(outboundChanges).length > 0) {
      syncOutboundUpdate(ticketId, outboundChanges)
        .then(result => {
          if (result.success) {
            logger.info('QContact outbound sync successful', { ticketId, changes: Object.keys(outboundChanges) });
          } else {
            logger.warn('QContact outbound sync failed', { ticketId, error: result.error_message });
          }
        })
        .catch(err => {
          logger.error('QContact outbound sync error', { ticketId, error: err.message });
        });
    }

    // Fire assignment notifications (non-blocking)
    if (oldTicket) {
      const assignedToChanged =
        body.assigned_to && body.assigned_to !== oldTicket.assigned_to;
      const teamChanged =
        body.assigned_team_id && body.assigned_team_id !== oldTicket.assigned_team_id;

      if (assignedToChanged) {
        triggerOnTicketAssignment(updatedTicket, oldTicket.status)
          .catch(err => {
            logger.error('Assignment notification error', { ticketId, error: err.message });
          });
      }

      if (teamChanged) {
        triggerOnTeamAssignment(updatedTicket)
          .catch(err => {
            logger.error('Team assignment notification error', { ticketId, error: err.message });
          });
      }
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

// ==================== DELETE /api/maintenance/tickets/[id] ====================

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

    // Sync cancellation to QContact (async, non-blocking)
    syncOutboundUpdate(ticketId, { status: TicketStatus.CANCELLED })
      .catch(err => {
        logger.error('QContact outbound sync error on delete', { ticketId, error: err.message });
      });

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
