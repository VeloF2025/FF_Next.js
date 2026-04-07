/**
 * Ticket CRUD API Route - Individual Ticket Operations
 *
 * 🟢 WORKING: Production-ready API endpoints for individual ticket operations
 *
 * GET    /api/noc/tickets/[id] - Get ticket detail
 * PUT    /api/noc/tickets/[id] - Update ticket
 * DELETE /api/noc/tickets/[id] - Soft delete ticket
 *
 * Features:
 * - UUID format validation
 * - Partial updates support (PUT)
 * - Soft delete (marks status as CANCELLED, never hard delete)
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import {
  getTicketById,
  updateTicket,
  deleteTicket,
  logTicketChanges,
  logTicketActivity,
} from '@/modules/noc/services/ticketService';
import { isTeamLead } from '@/modules/noc/services/teamService';
import { enrichTicketData } from '@/modules/noc/services/ticketEnrichmentService';
import { syncOutboundUpdate } from '@/modules/noc/services/qcontactSyncOutbound';
import {
  triggerOnTicketAssignment,
  triggerOnTeamAssignment,
  triggerCreatorStatusUpdate,
  triggerOnReassignment,
} from '@/modules/noc/services/notificationTriggers';
import { markLinkedDataSyncResolved } from '@/modules/noc/services/dataSyncResolution';
import type { UpdateTicketPayload } from '@/modules/noc/types/ticket';
import { TicketStatus } from '@/modules/noc/types/ticket';

const logger = createLogger('maintenance:api:tickets:id');
const sql = neon(process.env.DATABASE_URL!);

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

// ==================== GET /api/noc/tickets/[id] ====================

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

// ==================== PUT /api/noc/tickets/[id] ====================

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

    // Extract authenticated user for activity logging
    const cookieStore = await cookies();
    const token = cookieStore.get('ff_auth_token')?.value;
    let actingUser: { id?: string; name?: string; email?: string; role?: string } = {};
    if (token) {
      const jwt = await verifyToken(token);
      if (jwt) {
        actingUser = { id: jwt.sub, name: jwt.name as string, email: jwt.email as string, role: jwt.role as string };
      }
    }

    // Capture old state for change detection
    const oldTicket = await getTicketById(ticketId);

    // Team lead approval check: only team leads (or super_admin) can move resolved → closed
    if (
      body.status === 'closed' &&
      oldTicket?.status === 'resolved' &&
      oldTicket.assigned_team_id &&
      actingUser.id &&
      actingUser.role !== 'super_admin'
    ) {
      const userIsLead = await isTeamLead(actingUser.id, oldTicket.assigned_team_id);
      if (!userIsLead) {
        return validationError(
          'Only the team lead can approve and close a resolved ticket'
        );
      }
    }

    const updatedTicket = await updateTicket(ticketId, body);

    if (!updatedTicket) {
      return notFoundError('Ticket', ticketId);
    }

    // Log all field changes to activity trail (non-blocking)
    if (oldTicket) {
      logTicketChanges({
        ticketId,
        oldTicket: oldTicket as unknown as Record<string, any>,
        newTicket: updatedTicket as unknown as Record<string, any>,
        payload: body as Record<string, any>,
        userId: actingUser.id,
        userName: actingUser.name,
        userEmail: actingUser.email,
      }).catch(err => {
        logger.error('Activity logging error', { ticketId, error: err.message });
      });
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

    // Fire notifications (non-blocking)
    if (oldTicket) {
      const assignedToChanged =
        body.assigned_to && body.assigned_to !== oldTicket.assigned_to;
      const teamChanged =
        body.assigned_team_id && body.assigned_team_id !== oldTicket.assigned_team_id;
      const statusChanged =
        body.status && body.status !== oldTicket.status;

      // Notify new assignee (existing)
      if (assignedToChanged) {
        triggerOnTicketAssignment(updatedTicket, oldTicket.status)
          .catch(err => {
            logger.error('Assignment notification error', { ticketId, error: err.message });
          });

        // Notify old assignee + creator about the reassignment
        triggerOnReassignment(updatedTicket, oldTicket.assigned_to)
          .catch(err => {
            logger.error('Reassignment notification error', { ticketId, error: err.message });
          });
      }

      if (teamChanged) {
        triggerOnTeamAssignment(updatedTicket)
          .catch(err => {
            logger.error('Team assignment notification error', { ticketId, error: err.message });
          });
      }

      // Notify creator on status changes
      if (statusChanged) {
        triggerCreatorStatusUpdate(
          updatedTicket,
          oldTicket.status,
          body.status as TicketStatus
        ).catch(err => {
          logger.error('Creator status notification error', { ticketId, error: err.message });
        });
      }
    }

    // When ticket is resolved/closed, mark linked Data Sync records as resolved
    if (body.status && ['resolved', 'closed'].includes(body.status)) {
      markLinkedDataSyncResolved(ticketId)
        .catch(err => {
          logger.error('Data Sync resolution error', { ticketId, error: err.message });
        });
    }

    // Bi-directional sync: propagate NOC status back to linked snag
    // resolved → snag.status = 'fixed'; closed → snag.status = 'closed'
    if (body.status && ['resolved', 'closed'].includes(body.status) && updatedTicket.source === 'snags') {
      const snagStatus = body.status === 'resolved' ? 'fixed' : 'closed';
      sql`
        UPDATE snags
        SET status = ${snagStatus}, updated_at = NOW()
        WHERE noc_ticket_id = ${ticketId}
      `.catch(err => {
        logger.error('Snag status sync error', { ticketId, snagStatus, error: err instanceof Error ? err.message : String(err) });
      });
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

// ==================== DELETE /api/noc/tickets/[id] ====================

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

    // Extract authenticated user for activity logging
    const cookieStore = await cookies();
    const token = cookieStore.get('ff_auth_token')?.value;
    let actingUser: { id?: string; name?: string; email?: string } = {};
    if (token) {
      const jwt = await verifyToken(token);
      if (jwt) {
        actingUser = { id: jwt.sub, name: jwt.name as string, email: jwt.email as string };
      }
    }

    const deletedTicket = await deleteTicket(ticketId);

    if (!deletedTicket) {
      return notFoundError('Ticket', ticketId);
    }

    // Log cancellation to activity trail
    logTicketActivity({
      ticketId,
      activityType: 'cancelled',
      description: 'Ticket cancelled',
      userId: actingUser.id,
      userName: actingUser.name,
      userEmail: actingUser.email,
    }).catch(err => {
      logger.error('Activity logging error on delete', { ticketId, error: err.message });
    });

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
