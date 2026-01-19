/**
 * DR Lookup API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for DR number lookup
 *
 * GET /api/ticketing/dr-lookup/[drNumber] - Lookup DR details from SOW module
 *
 * Features:
 * - Queries SOW module for DR (Drop) information
 * - Returns project, zone, pole, PON, and location details
 * - Input validation for DR number
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { lookupDR } from '@/modules/ticketing/services/drLookupService';

const logger = createLogger('ticketing:api:dr-lookup');

// ==================== GET /api/ticketing/dr-lookup/[drNumber] ====================

/**
 * 🟢 WORKING: Lookup DR number and return complete details
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { drNumber: string } }
) {
  try {
    const { drNumber } = params;

    logger.debug('DR lookup request received', { drNumber });

    // Call the DR lookup service
    const result = await lookupDR(drNumber);

    // Handle different result scenarios
    if (result.success && result.data) {
      // Success - DR found
      logger.info('DR lookup successful', {
        drNumber: result.data.dr_number,
        projectId: result.data.project_id,
      });

      return NextResponse.json({
        success: true,
        data: result.data,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Handle validation errors (empty/whitespace DR number)
    if (!result.success && result.error?.includes('required')) {
      logger.warn('DR lookup validation error', {
        drNumber,
        error: result.error,
      });

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: result.error,
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 422 }
      );
    }

    // Handle not found
    if (!result.success && result.error?.includes('not found')) {
      logger.warn('DR number not found', { drNumber });

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'DR number not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 404 }
      );
    }

    // Handle database/service errors
    logger.error('DR lookup failed', {
      drNumber,
      error: result.error,
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: result.error || 'Failed to lookup DR number',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  } catch (error) {
    logger.error('Unexpected error in DR lookup endpoint', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to lookup DR number',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
