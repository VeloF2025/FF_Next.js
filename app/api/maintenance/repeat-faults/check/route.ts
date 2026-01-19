/**
 * Repeat Fault Pattern Check API Route
 * 🟢 WORKING: Production-ready API endpoint for checking repeat fault patterns
 *
 * GET /api/ticketing/repeat-faults/check - Check for repeat fault patterns
 *
 * Query Parameters:
 * - scope_type (required): 'pole' | 'pon' | 'zone' | 'dr'
 * - scope_value (required): The pole number, PON, zone ID, or DR number
 * - threshold (optional): Override default threshold for pattern detection
 * - time_window_days (optional): Override default time window (default: 30 days)
 * - project_id (optional): Filter by specific project
 *
 * Features:
 * - Configurable pattern detection thresholds
 * - Time window filtering
 * - Existing escalation detection (prevents duplicates)
 * - Detailed contributing ticket tracking
 * - Uses default thresholds if not specified
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  detectFaultPattern,
  getDefaultThresholds,
} from '@/modules/ticketing/utils/faultPatternDetector';
import { EscalationScopeType } from '@/modules/ticketing/types/escalation';

const logger = createLogger('ticketing:api:repeat-faults:check');

// Valid enum values for validation
const VALID_SCOPE_TYPES: EscalationScopeType[] = [
  EscalationScopeType.POLE,
  EscalationScopeType.PON,
  EscalationScopeType.ZONE,
  EscalationScopeType.DR,
];

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

// ==================== GET /api/ticketing/repeat-faults/check ====================

/**
 * 🟢 WORKING: Check for repeat fault patterns with configurable thresholds
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Validate required parameters
    const scope_type = searchParams.get('scope_type');
    const scope_value = searchParams.get('scope_value');

    if (!scope_type) {
      return validationError('scope_type is required', {
        valid_values: VALID_SCOPE_TYPES,
      });
    }

    if (!scope_value) {
      return validationError('scope_value is required');
    }

    // Validate scope_type
    if (!VALID_SCOPE_TYPES.includes(scope_type as any)) {
      return validationError(`Invalid scope_type: ${scope_type}`, {
        valid_values: VALID_SCOPE_TYPES,
      });
    }

    // Get default thresholds
    const defaultThresholds = getDefaultThresholds();

    // Parse optional parameters with defaults
    let threshold: number;
    let time_window_days: number;

    // Use scope-specific default threshold if not provided
    if (searchParams.has('threshold')) {
      const thresholdParam = searchParams.get('threshold')!;
      threshold = parseInt(thresholdParam, 10);

      if (isNaN(threshold) || threshold <= 0) {
        return validationError('threshold must be a positive integer');
      }
    } else {
      // Use default threshold based on scope type
      switch (scope_type) {
        case 'pole':
          threshold = defaultThresholds.pole_threshold;
          break;
        case 'pon':
          threshold = defaultThresholds.pon_threshold;
          break;
        case 'zone':
          threshold = defaultThresholds.zone_threshold;
          break;
        case 'dr':
          threshold = defaultThresholds.dr_threshold;
          break;
        default:
          threshold = 3; // Fallback
      }
    }

    // Parse time_window_days with default
    if (searchParams.has('time_window_days')) {
      const timeWindowParam = searchParams.get('time_window_days')!;
      time_window_days = parseInt(timeWindowParam, 10);

      if (isNaN(time_window_days) || time_window_days <= 0) {
        return validationError('time_window_days must be a positive integer');
      }
    } else {
      time_window_days = defaultThresholds.time_window_days;
    }

    // Optional project filter
    const project_id = searchParams.get('project_id') || undefined;

    logger.debug('Checking repeat fault pattern', {
      scope_type,
      scope_value,
      threshold,
      time_window_days,
      project_id,
    });

    // Detect fault pattern
    const patternResult = await detectFaultPattern({
      scope_type: scope_type as EscalationScopeType,
      scope_value,
      threshold,
      time_window_days,
      project_id,
    });

    return NextResponse.json({
      success: true,
      data: patternResult,
      meta: {
        defaults_used: {
          threshold: !searchParams.has('threshold'),
          time_window_days: !searchParams.has('time_window_days'),
        },
        default_thresholds: defaultThresholds,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error checking repeat fault pattern', { error });

    return databaseError('Failed to check repeat fault pattern');
  }
}
