/**
 * Verification Step Update API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for updating a specific verification step
 *
 * PUT /api/ticketing/tickets/[id]/verification/[step] - Update a verification step
 *
 * Features:
 * - Updates a specific step (1-12) for a ticket
 * - Supports partial updates (only provided fields updated)
 * - Automatic completion timestamp handling
 * - UUID and step number validation
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { updateVerificationStep } from '@/modules/ticketing/services/verificationService';
import type { UpdateVerificationStepPayload, VerificationStepNumber } from '@/modules/ticketing/types/verification';

const logger = createLogger('ticketing:api:verification:step');

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
 * Validate step number (must be 1-12)
 * 🟢 WORKING: Step number validation
 */
function isValidStepNumber(step: string): { valid: boolean; stepNumber?: number } {
  const num = parseInt(step, 10);
  if (isNaN(num) || num < 1 || num > 12) {
    return { valid: false };
  }
  return { valid: true, stepNumber: num };
}

/**
 * Validation error response
 * 🟢 WORKING: Standard validation error response
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

// ==================== PUT /api/ticketing/tickets/[id]/verification/[step] ====================

/**
 * 🟢 WORKING: Update a specific verification step
 *
 * Request body:
 * {
 *   is_complete?: boolean
 *   completed_by?: string  // UUID of user
 *   photo_url?: string
 *   photo_verified?: boolean
 *   notes?: string
 * }
 *
 * Response (200):
 * {
 *   success: true,
 *   data: VerificationStep,
 *   message: string
 * }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; step: string } }
) {
  try {
    const ticketId = params.id;
    const stepParam = params.step;

    // 🟢 WORKING: Validate UUID format
    if (!isValidUUID(ticketId)) {
      return validationError('Invalid ticket ID format. Must be a valid UUID');
    }

    // 🟢 WORKING: Validate step number
    const stepValidation = isValidStepNumber(stepParam);
    if (!stepValidation.valid) {
      return validationError(
        'Invalid step number. Must be an integer between 1 and 12',
        { provided: stepParam }
      );
    }

    const stepNumber = stepValidation.stepNumber as VerificationStepNumber;

    // 🟢 WORKING: Parse request body
    let payload: UpdateVerificationStepPayload;
    try {
      payload = await req.json();
    } catch (error) {
      return validationError('Invalid JSON in request body');
    }

    // 🟢 WORKING: Validate completed_by if provided
    if (payload.completed_by && !isValidUUID(payload.completed_by)) {
      return validationError('Invalid completed_by ID format. Must be a valid UUID');
    }

    logger.info('Updating verification step', {
      ticketId,
      stepNumber,
      fields: Object.keys(payload),
    });

    // 🟢 WORKING: Update the step
    const updatedStep = await updateVerificationStep(ticketId, stepNumber, payload);

    return NextResponse.json({
      success: true,
      data: updatedStep,
      message: `Verification step ${stepNumber} updated successfully`,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error updating verification step', {
      error,
      ticketId: params.id,
      step: params.step,
    });

    // 🟢 WORKING: Handle specific error types
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('step not found') || errorMessage.includes('not found')) {
      return notFoundError('Verification step', `${params.id}/step-${params.step}`);
    }

    return databaseError('Failed to update verification step');
  }
}
