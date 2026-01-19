/**
 * Escalation List API Route
 * 🟢 WORKING: Production-ready API endpoint for listing escalations
 *
 * GET /api/ticketing/escalations - List all escalations with optional filters
 *
 * Features:
 * - Multi-criteria filtering (scope_type, status, project_id, escalation_type)
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 * - Input validation for filter parameters
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { listEscalations } from '@/modules/ticketing/services/escalationService';
import {
  EscalationScopeType,
  EscalationStatus,
  EscalationType,
} from '@/modules/ticketing/types/escalation';
import type { EscalationFilters } from '@/modules/ticketing/types/escalation';

const logger = createLogger('ticketing:api:escalations');

// Valid enum values for validation
const VALID_SCOPE_TYPES: EscalationScopeType[] = [
  EscalationScopeType.POLE,
  EscalationScopeType.PON,
  EscalationScopeType.ZONE,
  EscalationScopeType.DR,
];
const VALID_STATUSES: EscalationStatus[] = [
  EscalationStatus.OPEN,
  EscalationStatus.INVESTIGATING,
  EscalationStatus.RESOLVED,
  EscalationStatus.NO_ACTION,
];
const VALID_ESCALATION_TYPES: EscalationType[] = [
  EscalationType.INVESTIGATION,
  EscalationType.INSPECTION,
  EscalationType.REPLACEMENT,
];

// ==================== GET /api/ticketing/escalations ====================

/**
 * 🟢 WORKING: List escalations with filters
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const filters: EscalationFilters = {};

    // Scope type filter (single or multiple)
    if (searchParams.has('scope_type')) {
      const scopeTypeParam = searchParams.get('scope_type')!;
      const scopeTypes = scopeTypeParam.split(',').map((st) => st.trim());

      // Validate scope types
      const invalidScopeTypes = scopeTypes.filter((st) => !VALID_SCOPE_TYPES.includes(st as any));
      if (invalidScopeTypes.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid scope_type values: ${invalidScopeTypes.join(', ')}`,
              details: {
                valid_values: VALID_SCOPE_TYPES,
              },
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }

      filters.scope_type =
        scopeTypes.length === 1
          ? (scopeTypes[0] as EscalationScopeType)
          : (scopeTypes as EscalationScopeType[]);
    }

    // Status filter (single or multiple)
    if (searchParams.has('status')) {
      const statusParam = searchParams.get('status')!;
      const statuses = statusParam.split(',').map((s) => s.trim());

      // Validate statuses
      const invalidStatuses = statuses.filter((s) => !VALID_STATUSES.includes(s as any));
      if (invalidStatuses.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid status values: ${invalidStatuses.join(', ')}`,
              details: {
                valid_values: VALID_STATUSES,
              },
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }

      filters.status =
        statuses.length === 1 ? (statuses[0] as EscalationStatus) : (statuses as EscalationStatus[]);
    }

    // Project ID filter
    if (searchParams.has('project_id')) {
      filters.project_id = searchParams.get('project_id')!;
    }

    // Escalation type filter
    if (searchParams.has('escalation_type')) {
      const escalationType = searchParams.get('escalation_type')!;

      // Validate escalation type
      if (!VALID_ESCALATION_TYPES.includes(escalationType as any)) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid escalation_type: ${escalationType}`,
              details: {
                valid_values: VALID_ESCALATION_TYPES,
              },
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }

      filters.escalation_type = escalationType as EscalationType;
    }

    logger.debug('Fetching escalations with filters', { filters });

    const escalations = await listEscalations(filters);

    return NextResponse.json({
      success: true,
      data: escalations,
      meta: {
        count: escalations.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error fetching escalations', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch escalations',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
