/**
 * Risk Acceptances List API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for listing ticket risk acceptances
 *
 * GET /api/ticketing/tickets/[id]/risk-acceptances - List risk acceptances for ticket
 *
 * Features:
 * - List all risk acceptances for a ticket
 * - Filter by status (active, resolved, expired, escalated)
 * - Returns empty array if no risks exist
 * - Validates UUID format
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { listRisksForTicket } from '@/modules/ticketing/services/riskAcceptanceService';
import type { RiskAcceptanceStatus } from '@/modules/ticketing/types/riskAcceptance';

const logger = createLogger('ticketing:api:risk-acceptances');

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

// ==================== GET /api/ticketing/tickets/[id]/risk-acceptances ====================

/**
 * 🟢 WORKING: Get all risk acceptances for a ticket
 *
 * Query parameters:
 * - status?: string  // Optional: Filter by status (default: 'active')
 *
 * Response (200):
 * {
 *   success: true,
 *   data: QARiskAcceptance[],
 *   meta: {
 *     count: number,
 *     timestamp: string
 *   }
 * }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ticketId = params.id;

    // 🟢 WORKING: Validate ticket ID format
    if (!isValidUUID(ticketId)) {
      return validationError('Invalid ticket ID format. Must be a valid UUID');
    }

    // 🟢 WORKING: Get status filter from query params (default: 'active')
    const { searchParams } = new URL(req.url);
    const status = (searchParams.get('status') || 'active') as RiskAcceptanceStatus;

    logger.debug('Listing risk acceptances', { ticketId, status });

    // 🟢 WORKING: Get risk acceptances from service
    const risks = await listRisksForTicket(ticketId, status);

    return NextResponse.json({
      success: true,
      data: risks,
      meta: {
        count: risks.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error listing risk acceptances', {
      error,
      ticketId: params.id,
    });

    return databaseError('Failed to list risk acceptances');
  }
}
