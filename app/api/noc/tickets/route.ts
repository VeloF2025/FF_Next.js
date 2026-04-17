/**
 * Ticket CRUD API Route - List and Create
 *
 * 🟢 WORKING: Production-ready API endpoints for ticket listing and creation
 *
 * GET  /api/noc/tickets - List all tickets with optional filters
 * POST /api/noc/tickets - Create new ticket
 *
 * Features:
 * - Multi-criteria filtering (status, type, priority, assigned_to, etc.)
 * - Pagination support
 * - Input validation
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (structured logger only, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import {
  listTickets,
  createTicket,
  logTicketActivity,
} from '@/modules/noc/services/ticketService';
import {
  triggerOnTicketAssignment,
  triggerOnTeamAssignment,
} from '@/modules/noc/services/notificationTriggers';
import { notifySnagGroupOnCreate } from '@/modules/noc/services/snagGroupNotifications';
import { initializeVerificationSteps } from '@/modules/noc/services/verificationService';
import {
  TicketSource,
  TicketType,
  TicketPriority,
  TicketStatus,
  TicketCategory,
} from '@/modules/noc/types/ticket';
import type {
  CreateTicketPayload,
  TicketFilters,
} from '@/modules/noc/types/ticket';
import { isValidManualTaxonomy } from '@/modules/noc/constants/manualTicketTaxonomy';

const logger = createLogger('maintenance:api:tickets');

// Valid enum values for validation
const VALID_SOURCES: TicketSource[] = [
  TicketSource.QCONTACT,
  TicketSource.WEEKLY_REPORT,
  TicketSource.CONSTRUCTION,
  TicketSource.AD_HOC,
  TicketSource.INCIDENT,
  TicketSource.REVENUE,
  TicketSource.ONT_SWAP,
  TicketSource.MANUAL,
  TicketSource.OFFLINE_REPORT,
  TicketSource.QA_REVIEW,
  TicketSource.HSE_REPORT,
  TicketSource.WA_MAINTENANCE,
  TicketSource.PP_DATA,
  TicketSource.OLT_MISMATCH,
  TicketSource.DEV_OPS,
  TicketSource.SNAGS,
];

const VALID_TYPES: TicketType[] = [
  TicketType.CIVILS,
  TicketType.OPTICAL,
  TicketType.ACTIVATIONS,
  TicketType.MAINTENANCE,
  TicketType.DEV_OPS,
  TicketType.UNSPECIFIED,
];

const VALID_PRIORITIES: TicketPriority[] = [
  TicketPriority.LOW,
  TicketPriority.NORMAL,
  TicketPriority.HIGH,
  TicketPriority.URGENT,
  TicketPriority.CRITICAL,
];

// ==================== GET /api/noc/tickets ====================

/**
 * 🟢 WORKING: List tickets with filters and pagination
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const filters: TicketFilters = {};

    // Single-value filters
    if (searchParams.has('status')) {
      filters.status = searchParams.get('status') as TicketStatus;
    }
    if (searchParams.has('exclude_status')) {
      // Blacklist — repeated ?exclude_status=closed&exclude_status=cancelled
      filters.exclude_status = searchParams.getAll('exclude_status') as TicketStatus[];
    }
    if (searchParams.has('sort')) {
      filters.sort = searchParams.get('sort')!;
    }
    if (searchParams.has('ticket_type')) {
      const types = searchParams.getAll('ticket_type');
      // Array when T1 category filter expanded multiple types; single otherwise
      filters.ticket_type = types.length === 1 ? (types[0] as TicketType) : (types as TicketType[]);
    }
    if (searchParams.has('priority')) {
      filters.priority = searchParams.get('priority') as TicketPriority;
    }
    if (searchParams.has('source')) {
      filters.source = searchParams.get('source') as TicketSource;
    }
    if (searchParams.has('ticket_category')) {
      filters.ticket_category = searchParams.get('ticket_category') as TicketCategory;
    }
    if (searchParams.has('assigned_to')) {
      filters.assigned_to = searchParams.get('assigned_to')!;
    }
    if (searchParams.has('assigned_team_id')) {
      filters.assigned_team_id = searchParams.get('assigned_team_id')!;
    }
    if (searchParams.has('project_id')) {
      filters.project_id = searchParams.get('project_id')!;
    }
    if (searchParams.has('dr_number')) {
      filters.dr_number = searchParams.get('dr_number')!;
    }
    if (searchParams.has('qa_ready')) {
      filters.qa_ready = searchParams.get('qa_ready') === 'true';
    }
    if (searchParams.has('sla_breached')) {
      filters.sla_breached = searchParams.get('sla_breached') === 'true';
    }

    // Date range filters
    if (searchParams.has('created_after')) {
      filters.created_after = new Date(searchParams.get('created_after')!);
    }
    if (searchParams.has('created_before')) {
      filters.created_before = new Date(searchParams.get('created_before')!);
    }

    // Search term
    if (searchParams.has('search')) {
      filters.search = searchParams.get('search')!;
    }

    // Pagination
    if (searchParams.has('page')) {
      filters.page = parseInt(searchParams.get('page')!, 10);
    }
    if (searchParams.has('pageSize')) {
      filters.pageSize = parseInt(searchParams.get('pageSize')!, 10);
    }

    logger.debug('Fetching tickets with filters', { filters });

    const result = await listTickets(filters);

    return NextResponse.json({
      success: true,
      data: result.tickets,
      pagination: {
        page: result.page,
        pageSize: result.limit,
        total: result.total,
        totalPages: result.total_pages,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error fetching tickets', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch tickets',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}

// ==================== POST /api/noc/tickets ====================

/**
 * 🟢 WORKING: Create new ticket with validation
 */
export async function POST(req: NextRequest) {
  try {
    const body: CreateTicketPayload = await req.json();

    // Extract user ID from JWT cookie for created_by (UUID column)
    const cookieStore = await cookies();
    const token = cookieStore.get('ff_auth_token')?.value;
    if (token) {
      const payload = await verifyToken(token);
      if (payload?.sub) {
        body.created_by = payload.sub;
      }
    }

    if (!body.created_by) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 401 }
      );
    }

    // Validate required fields
    const errors: Record<string, string> = {};

    if (!body.source) {
      errors.source = 'Source is required';
    } else if (!VALID_SOURCES.includes(body.source)) {
      errors.source = `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`;
    }

    if (!body.title || body.title.trim() === '') {
      errors.title = 'Title is required';
    }

    if (!body.ticket_type) {
      errors.ticket_type = 'Ticket type is required';
    } else if (!VALID_TYPES.includes(body.ticket_type)) {
      errors.ticket_type = `Invalid ticket type. Must be one of: ${VALID_TYPES.join(', ')}`;
    }

    // Validate optional enums if provided
    if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
      errors.priority = `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`;
    }

    // Manual submissions must land on an approved (ticket_category, ticket_type)
    // pair from MANUAL_TICKET_TAXONOMY. Auto-ingest callers (QContact sync, TQR
    // import, WhatsApp bridge) use their own classification paths and bypass
    // this check because they authenticate with system users and write
    // non-manual source values.
    if (body.source === TicketSource.MANUAL) {
      if (!body.ticket_category) {
        errors.ticket_category = 'Category is required for manual tickets';
      } else if (
        body.ticket_type &&
        !isValidManualTaxonomy(body.ticket_category, body.ticket_type)
      ) {
        errors.ticket_type = 'Invalid category / discipline combination for manual ticket';
      }
    }

    // If validation errors, return 422
    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: errors,
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 422 }
      );
    }

    logger.info('Creating new ticket', {
      source: body.source,
      title: body.title,
      type: body.ticket_type
    });

    const ticket = await createTicket(body);

    // Log ticket creation to activity trail
    logTicketActivity({
      ticketId: ticket.id,
      activityType: 'created',
      description: `Ticket created: ${body.title || ticket.ticket_uid}`,
      userId: body.created_by,
    }).catch(err => {
      logger.error('Activity logging error on create', { ticketId: ticket.id, error: err.message });
    });

    // Fire notifications for initial assignment (non-blocking)
    // Only one path: individual OR team — never both to avoid doubles
    if (ticket.assigned_to) {
      triggerOnTicketAssignment(ticket, ticket.status).catch(err => {
        logger.error('Assignment notification error on create', { ticketId: ticket.id, error: err.message });
      });
    } else if (ticket.assigned_team_id) {
      triggerOnTeamAssignment(ticket).catch(err => {
        logger.error('Team assignment notification error on create', { ticketId: ticket.id, error: err.message });
      });
    }

    // Auto-initialize verification steps for the ticket (non-blocking)
    if (body.ticket_type) {
      initializeVerificationSteps(ticket.id, body.ticket_type).catch(err => {
        logger.error('Verification step init error on create', { ticketId: ticket.id, type: body.ticket_type, error: err.message });
      });
    }

    // Snag tickets: notify project WhatsApp group (non-blocking)
    notifySnagGroupOnCreate(ticket).catch(err => {
      logger.error('Snag WA group notification error on create', { ticketId: ticket.id, error: err.message });
    });

    return NextResponse.json(
      {
        success: true,
        data: ticket,
        message: 'Ticket created successfully',
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('Error creating ticket', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to create ticket',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
