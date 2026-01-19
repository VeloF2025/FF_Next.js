/**
 * Risk Acceptance Resolution API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for resolving risk acceptances
 *
 * PUT /api/ticketing/risk-acceptances/[id]/resolve - Resolve risk acceptance
 *
 * Features:
 * - Mark risk acceptance as resolved
 * - Record resolution details (resolved_by, resolution_notes)
 * - Validate required fields
 * - Validate UUID formats
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { resolveRiskAcceptance } from '@/modules/ticketing/services/riskAcceptanceService';
import type { ResolveRiskAcceptancePayload } from '@/modules/ticketing/types/riskAcceptance';

const logger = createLogger('ticketing:api:risk-acceptance-resolve');

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

// ==================== PUT /api/ticketing/risk-acceptances/[id]/resolve ====================

/**
 * 🟢 WORKING: Resolve a risk acceptance
 *
 * Request body:
 * {
 *   resolved_by: string,      // Required: UUID of user resolving the risk
 *   resolution_notes: string  // Required: Notes on how risk was resolved
 * }
 *
 * Response (200):
 * {
 *   success: true,
 *   data: QARiskAcceptance,
 *   message: string
 * }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const riskId = params.id;

    // 🟢 WORKING: Validate risk acceptance ID format
    if (!isValidUUID(riskId)) {
      return validationError('Invalid risk acceptance ID format. Must be a valid UUID');
    }

    // 🟢 WORKING: Parse and validate request body
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      return validationError('Invalid JSON in request body');
    }

    // 🟢 WORKING: Validate required fields
    if (!body.resolved_by) {
      return validationError('resolved_by is required');
    }

    if (!body.resolution_notes) {
      return validationError('resolution_notes is required');
    }

    // 🟢 WORKING: Validate resolved_by UUID format
    if (!isValidUUID(body.resolved_by)) {
      return validationError('Invalid resolved_by ID format. Must be a valid UUID');
    }

    // 🟢 WORKING: Build payload for service
    const payload: ResolveRiskAcceptancePayload = {
      resolved_by: body.resolved_by,
      resolution_notes: body.resolution_notes,
    };

    logger.info('Resolving risk acceptance', {
      riskId,
      resolvedBy: payload.resolved_by,
    });

    // 🟢 WORKING: Resolve the risk acceptance
    const resolvedRisk = await resolveRiskAcceptance(riskId, payload);

    return NextResponse.json({
      success: true,
      data: resolvedRisk,
      message: 'Risk acceptance resolved successfully',
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error resolving risk acceptance', {
      error,
      riskId: params.id,
    });

    // 🟢 WORKING: Handle specific error types
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes('is required') ||
      errorMessage.includes('cannot be empty')
    ) {
      return validationError(errorMessage);
    }

    if (errorMessage.includes('not found')) {
      return notFoundError('Risk acceptance', params.id);
    }

    return databaseError('Failed to resolve risk acceptance');
  }
}
