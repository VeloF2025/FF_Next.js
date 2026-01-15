/**
 * Fleet Analytics API - Upcoming Services
 * GET /api/fleet/analytics/upcoming-services - Get services due soon
 *
 * Query params:
 * - days: number (default: 90) - Look ahead days
 * - urgency: 'ok' | 'warning' | 'critical' | 'overdue' (optional filter)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getUpcomingServices } from '@/modules/fleet/services';
import type { ServiceUrgency } from '@/modules/fleet/types/maintenance.types';

export default withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { days = '90', urgency } = req.query;

    // Validate days
    const daysNum = parseInt(days as string, 10);
    if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
      return apiResponse.validationError(res, { days: 'Invalid days. Use a number between 1 and 365' });
    }

    // Validate urgency if provided
    const validUrgencies = ['ok', 'warning', 'critical', 'overdue'];
    if (urgency && !validUrgencies.includes(urgency as string)) {
      return apiResponse.validationError(res, {
        urgency: 'Invalid urgency. Use "ok", "warning", "critical", or "overdue"'
      });
    }

    const services = await getUpcomingServices(
      daysNum,
      urgency as ServiceUrgency | undefined
    );

    return apiResponse.success(res, services);
  } catch (error) {
    log.error('Failed to get upcoming services', { error });
    return apiResponse.internalError(res, error);
  }
});
