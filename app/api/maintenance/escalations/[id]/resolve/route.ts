/**
 * Escalation Resolve API Route
 * 🟢 WORKING: Production-ready API endpoint for resolving escalations
 *
 * POST /api/ticketing/escalations/[id]/resolve - Resolve or mark escalation as no_action
 *
 * Features:
 * - UUID format validation
 * - Resolution notes validation (required, non-empty)
 * - Status validation (must be 'resolved' or 'no_action')
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { resolveEscalation } from '@/modules/ticketing/services/escalationService';
import type { ResolveEscalationPayload, EscalationStatus } from '@/modules/ticketing/types/escalation';

const logger = createLogger('ticketing:api:escalations:resolve');

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

// ==================== POST /api/ticketing/escalations/[id]/resolve ====================

/**
 * 🟢 WORKING: Resolve escalation with validation
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const escalationId = params.id;

    // Validate UUID format
    if (!isValidUUID(escalationId)) {
      return validationError('Invalid escalation ID format. Must be a valid UUID');
    }

    const body = await req.json();

    // Validate required fields
    const errors: Record<string, string> = {};

    if (!body.resolved_by) {
      errors.resolved_by = 'resolved_by is required (user ID)';
    }

    if (!body.resolution_notes || typeof body.resolution_notes !== 'string') {
      errors.resolution_notes = 'resolution_notes is required';
    } else if (body.resolution_notes.trim() === '') {
      errors.resolution_notes = 'resolution_notes cannot be empty';
    }

    if (!body.status) {
      errors.status = 'status is required';
    } else if (body.status !== 'resolved' && body.status !== 'no_action') {
      errors.status = 'status must be either "resolved" or "no_action"';
    }

    // If validation errors, return 422
    if (Object.keys(errors).length > 0) {
      return validationError('Validation failed', errors);
    }

    // Build resolve payload
    const resolvePayload: ResolveEscalationPayload = {
      resolved_by: body.resolved_by,
      resolution_notes: body.resolution_notes.trim(),
      status: body.status as EscalationStatus.RESOLVED | EscalationStatus.NO_ACTION,
    };

    logger.info('Resolving escalation', {
      escalationId,
      status: resolvePayload.status,
      resolved_by: resolvePayload.resolved_by,
    });

    const resolvedEscalation = await resolveEscalation(escalationId, resolvePayload);

    if (!resolvedEscalation) {
      return notFoundError('Escalation', escalationId);
    }

    return NextResponse.json(
      {
        success: true,
        data: resolvedEscalation,
        message: `Escalation ${resolvePayload.status === 'resolved' ? 'resolved' : 'marked as no action'} successfully`,
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    // Handle specific error cases
    if (error instanceof Error) {
      if (error.message === 'Escalation not found') {
        return notFoundError('Escalation', params.id);
      }
      if (error.message === 'Invalid escalation ID format') {
        return validationError(error.message);
      }
      if (error.message === 'resolution_notes is required') {
        return validationError(error.message);
      }
    }

    logger.error('Error resolving escalation', { error, escalationId: params.id });
    return databaseError('Failed to resolve escalation');
  }
}
