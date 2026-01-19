/**
 * Handover Creation API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for creating handover snapshots
 *
 * POST /api/ticketing/tickets/[id]/handover - Create handover snapshot
 *
 * Features:
 * - Validate handover gates before creation
 * - Create immutable handover snapshot
 * - Transfer ownership between teams (Build → QA → Maintenance)
 * - Lock snapshot after creation
 * - Validate required fields (handover_type, handover_by)
 * - Validate UUID formats
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  validateHandoverGate,
  createHandoverSnapshot,
} from '@/modules/ticketing/services/handoverService';
import type {
  CreateHandoverSnapshotPayload,
  HandoverType,
  OwnerType,
} from '@/modules/ticketing/types/handover';

const logger = createLogger('ticketing:api:handover');

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
 * Handover gate failure response
 * 🟢 WORKING: Special response for handover gate validation failures
 */
function handoverGateError(message: string, validationResult: any) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'HANDOVER_GATE_FAILED',
        message,
        details: {
          can_handover: validationResult.can_handover,
          blocking_issues: validationResult.blocking_issues,
          warnings: validationResult.warnings,
          gates_passed: validationResult.gates_passed,
          gates_failed: validationResult.gates_failed,
        },
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
function notFoundError(message: string) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message,
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

// ==================== POST /api/ticketing/tickets/[id]/handover ====================

/**
 * 🟢 WORKING: Create a new handover snapshot for a ticket
 *
 * Request body:
 * {
 *   handover_type: string,              // Required: Type of handover (build_to_qa, qa_to_maintenance, maintenance_complete)
 *   handover_by: string,                // Required: UUID of user performing handover
 *   from_owner_type?: string,           // Optional: Owner type handing over (build, qa, maintenance)
 *   from_owner_id?: string,             // Optional: UUID of owner handing over
 *   to_owner_type?: string,             // Optional: Owner type receiving handover
 *   to_owner_id?: string                // Optional: UUID of owner receiving handover
 * }
 *
 * Response (201):
 * {
 *   success: true,
 *   data: HandoverSnapshot,
 *   message: string
 * }
 *
 * Error responses:
 * - 422: Validation error (invalid fields, missing required fields, gate validation failed)
 * - 404: Ticket not found
 * - 500: Database error
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ticketId = params.id;

    // 🟢 WORKING: Validate ticket ID format
    if (!isValidUUID(ticketId)) {
      return validationError('Invalid ticket ID format. Must be a valid UUID');
    }

    // 🟢 WORKING: Parse and validate request body
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      return validationError('Invalid JSON in request body');
    }

    // 🟢 WORKING: Validate required fields
    if (!body.handover_type) {
      return validationError('handover_type is required');
    }

    if (!body.handover_by) {
      return validationError('handover_by is required');
    }

    // 🟢 WORKING: Validate handover_by UUID format
    if (!isValidUUID(body.handover_by)) {
      return validationError('Invalid handover_by ID format. Must be a valid UUID');
    }

    // 🟢 WORKING: Validate optional owner ID UUIDs
    if (body.from_owner_id && !isValidUUID(body.from_owner_id)) {
      return validationError('Invalid from_owner_id format. Must be a valid UUID');
    }

    if (body.to_owner_id && !isValidUUID(body.to_owner_id)) {
      return validationError('Invalid to_owner_id format. Must be a valid UUID');
    }

    logger.info('Validating handover gates', {
      ticketId,
      handoverType: body.handover_type,
      handoverBy: body.handover_by,
    });

    // 🟢 WORKING: Validate handover gates before creating snapshot
    const gateValidation = await validateHandoverGate(
      ticketId,
      body.handover_type as HandoverType
    );

    // If gates failed, return detailed error
    if (!gateValidation.can_handover) {
      logger.warn('Handover gate validation failed', {
        ticketId,
        blockingIssues: gateValidation.blocking_issues.length,
        warnings: gateValidation.warnings.length,
      });

      return handoverGateError(
        'Handover gates validation failed. Please resolve blocking issues before handover.',
        gateValidation
      );
    }

    // 🟢 WORKING: Build payload for service
    const payload: CreateHandoverSnapshotPayload = {
      ticket_id: ticketId,
      handover_type: body.handover_type as HandoverType,
      from_owner_type: body.from_owner_type as OwnerType || null,
      from_owner_id: body.from_owner_id || null,
      to_owner_type: body.to_owner_type as OwnerType || null,
      to_owner_id: body.to_owner_id || null,
      handover_by: body.handover_by,
    };

    logger.info('Creating handover snapshot', {
      ticketId,
      handoverType: payload.handover_type,
      fromOwner: payload.from_owner_type,
      toOwner: payload.to_owner_type,
    });

    // 🟢 WORKING: Create the handover snapshot
    const handoverSnapshot = await createHandoverSnapshot(payload);

    logger.info('Handover snapshot created successfully', {
      snapshotId: handoverSnapshot.id,
      ticketId,
    });

    return NextResponse.json(
      {
        success: true,
        data: handoverSnapshot,
        message: 'Handover snapshot created successfully',
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('Error creating handover snapshot', {
      error,
      ticketId: params.id,
    });

    // 🟢 WORKING: Handle specific error types
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for "not found" errors
    if (errorMessage.toLowerCase().includes('not found')) {
      return notFoundError(errorMessage);
    }

    // Check for validation errors
    if (
      errorMessage.includes('is required') ||
      errorMessage.includes('cannot be empty') ||
      errorMessage.includes('Invalid') ||
      errorMessage.includes('must be')
    ) {
      return validationError(errorMessage);
    }

    // Default to database error
    return databaseError('Failed to create handover snapshot');
  }
}
