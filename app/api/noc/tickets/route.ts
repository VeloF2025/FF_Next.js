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
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  listTickets,
  createTicket
} from '@/modules/noc/services/ticketService';
import {
  TicketSource,
  TicketType,
  TicketPriority,
} from '@/modules/noc/types/ticket';
import type {
  CreateTicketPayload,
  TicketFilters,
} from '@/modules/noc/types/ticket';

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
  TicketSource.PP_DATA,
];

const VALID_TYPES: TicketType[] = [
  TicketType.FAULT_REPAIR,
  TicketType.NEW_INSTALLATION,
  TicketType.MODIFICATION,
  TicketType.ONT_SWAP,
  TicketType.INCIDENT,
  TicketType.PRE_PROVISION,
  TicketType.SERIAL_MISMATCH,
  TicketType.OLT_INVESTIGATION,
  TicketType.HSE_INCIDENT,
  TicketType.HSE_NEAR_MISS,
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
      filters.status = searchParams.get('status') as any;
    }
    if (searchParams.has('ticket_type')) {
      filters.ticket_type = searchParams.get('ticket_type') as any;
    }
    if (searchParams.has('priority')) {
      filters.priority = searchParams.get('priority') as any;
    }
    if (searchParams.has('source')) {
      filters.source = searchParams.get('source') as any;
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
