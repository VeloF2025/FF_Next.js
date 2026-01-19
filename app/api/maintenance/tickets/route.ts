/**
 * Ticket CRUD API Route - List and Create
 *
 * 🟢 WORKING: Production-ready API endpoints for ticket listing and creation
 *
 * GET  /api/ticketing/tickets - List all tickets with optional filters
 * POST /api/ticketing/tickets - Create new ticket
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
} from '@/modules/maintenance/services/ticketService';
import type {
  CreateTicketPayload,
  TicketFilters,
  TicketSource,
  TicketType,
  TicketPriority,
} from '@/modules/maintenance/types/ticket';

const logger = createLogger('ticketing:api:tickets');

// Valid enum values for validation
const VALID_SOURCES: TicketSource[] = [
  'qcontact',
  'weekly_report',
  'construction',
  'ad_hoc',
  'incident',
  'revenue',
  'ont_swap',
  'manual',
];

const VALID_TYPES: TicketType[] = [
  'maintenance',
  'new_installation',
  'modification',
  'ont_swap',
  'incident',
];

const VALID_PRIORITIES: TicketPriority[] = [
  'low',
  'normal',
  'high',
  'urgent',
  'critical',
];

// ==================== GET /api/ticketing/tickets ====================

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

// ==================== POST /api/ticketing/tickets ====================

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
