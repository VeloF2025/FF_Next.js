/**
 * Daily Stock Reconciliation Report API
 * GET /api/field-stock/reports/daily-reconciliation
 *
 * Provides end-of-day stock accountability report per technician
 * Part of the 4-stage Site Stock Tracking System
 *
 * Query Parameters:
 * - date: string (required) - YYYY-MM-DD format
 * - project?: string - Filter by project name
 * - technicianId?: string - Filter to single technician
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  reconciliationService,
  type DailyReconciliationResponse,
  type ReconciliationQuery,
} from '@/modules/field-stock/services/reconciliationService';
import { log } from '@/lib/logger';

// ==================== TYPES ====================

interface SuccessResponse {
  success: true;
  data: DailyReconciliationResponse;
}

interface ErrorResponse {
  success: false;
  error: {
    code: 'VALIDATION_ERROR' | 'DATABASE_ERROR' | 'NOT_FOUND';
    message: string;
  };
}

type ApiResponse = SuccessResponse | ErrorResponse;

// ==================== VALIDATION ====================

interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  query?: ReconciliationQuery;
}

/**
 * Validate date format is YYYY-MM-DD
 */
function isValidDateFormat(date: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return false;
  }

  // Also check if it's a valid date
  const parsed = new Date(date);
  return !isNaN(parsed.getTime());
}

function validateRequest(query: Partial<Record<string, string | string[]>>): ValidationResult {
  const errors: Record<string, string> = {};

  // Validate date (required)
  const dateParam = Array.isArray(query.date) ? query.date[0] : query.date;
  if (!dateParam) {
    errors.date = 'date query parameter is required';
  } else if (!isValidDateFormat(dateParam)) {
    errors.date = 'date must be in YYYY-MM-DD format';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  // Build validated query object
  const projectParam = Array.isArray(query.project) ? query.project[0] : query.project;
  const technicianIdParam = Array.isArray(query.technicianId) ? query.technicianId[0] : query.technicianId;

  return {
    valid: true,
    errors: {},
    query: {
      date: dateParam!,
      project: projectParam || undefined,
      technicianId: technicianIdParam || undefined,
    },
  };
}

// ==================== HANDLER ====================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse | { error: string }>
): Promise<void> {
  // Only allow GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    return;
  }

  try {
    // Validate request
    const validation = validateRequest(req.query);
    if (!validation.valid) {
      const errorMessage = Object.entries(validation.errors)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join('; ');

      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: errorMessage,
        },
      });
      return;
    }

    // Get reconciliation data
    const reconciliationData = await reconciliationService.getDailyReconciliation(validation.query!);

    log.info('Daily reconciliation report generated', {
      date: validation.query!.date,
      technicianCount: reconciliationData.technicians.length,
      totalUnaccounted: reconciliationData.summary.total_unaccounted,
    });

    res.status(200).json({
      success: true,
      data: reconciliationData,
    });
  } catch (error) {
    log.error('Daily reconciliation error', { error });

    res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? `Internal error: ${error.message}` : 'Internal server error',
      },
    });
  }
}
