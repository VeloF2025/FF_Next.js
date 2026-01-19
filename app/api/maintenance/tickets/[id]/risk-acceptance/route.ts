/**
 * Risk Acceptance Creation API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for creating QA risk acceptances
 *
 * POST /api/ticketing/tickets/[id]/risk-acceptance - Create risk acceptance
 *
 * Features:
 * - Create risk acceptance with conditional approval
 * - Track expiry dates and follow-up requirements
 * - Validate required fields (risk_type, risk_description, accepted_by)
 * - Validate UUID formats
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { createRiskAcceptance } from '@/modules/ticketing/services/riskAcceptanceService';
import type { CreateRiskAcceptancePayload } from '@/modules/ticketing/types/riskAcceptance';

const logger = createLogger('ticketing:api:risk-acceptance');

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

// ==================== POST /api/ticketing/tickets/[id]/risk-acceptance ====================

/**
 * 🟢 WORKING: Create a new risk acceptance for a ticket
 *
 * Request body:
 * {
 *   risk_type: string,                // Required: Type of risk being accepted
 *   risk_description: string,         // Required: Description of the risk
 *   conditions?: string,              // Optional: Conditions for acceptance
 *   risk_expiry_date?: string,        // Optional: When risk must be resolved (ISO date)
 *   requires_followup?: boolean,      // Optional: Whether follow-up is needed (default: true)
 *   followup_date?: string,           // Optional: Follow-up date (ISO date)
 *   accepted_by: string               // Required: UUID of user accepting risk
 * }
 *
 * Response (201):
 * {
 *   success: true,
 *   data: QARiskAcceptance,
 *   message: string
 * }
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
    if (!body.risk_type) {
      return validationError('risk_type is required');
    }

    if (!body.risk_description) {
      return validationError('risk_description is required');
    }

    if (!body.accepted_by) {
      return validationError('accepted_by is required');
    }

    // 🟢 WORKING: Validate accepted_by UUID format
    if (!isValidUUID(body.accepted_by)) {
      return validationError('Invalid accepted_by ID format. Must be a valid UUID');
    }

    // 🟢 WORKING: Build payload for service
    const payload: CreateRiskAcceptancePayload = {
      ticket_id: ticketId,
      risk_type: body.risk_type,
      risk_description: body.risk_description,
      conditions: body.conditions || null,
      risk_expiry_date: body.risk_expiry_date || null,
      requires_followup: body.requires_followup !== undefined ? body.requires_followup : true,
      followup_date: body.followup_date || null,
      accepted_by: body.accepted_by,
    };

    logger.info('Creating risk acceptance', {
      ticketId,
      riskType: payload.risk_type,
      acceptedBy: payload.accepted_by,
    });

    // 🟢 WORKING: Create the risk acceptance
    const riskAcceptance = await createRiskAcceptance(payload);

    return NextResponse.json(
      {
        success: true,
        data: riskAcceptance,
        message: 'Risk acceptance created successfully',
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('Error creating risk acceptance', {
      error,
      ticketId: params.id,
    });

    // 🟢 WORKING: Handle specific error types
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes('is required') ||
      errorMessage.includes('cannot be empty') ||
      errorMessage.includes('Invalid risk_type')
    ) {
      return validationError(errorMessage);
    }

    return databaseError('Failed to create risk acceptance');
  }
}
