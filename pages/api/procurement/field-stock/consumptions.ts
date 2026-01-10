/**
 * Field Stock Consumptions API
 * GET /api/procurement/field-stock/consumptions - List consumptions
 * POST /api/procurement/field-stock/consumptions - Record a new consumption
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  getConsumptions,
  recordConsumption,
  getConsumptionsByDrop,
  getConsumptionsByTechnician,
  getUnverifiedCount,
} from '@/modules/procurement/field-stock/services/consumptionService';
import type { RecordConsumptionInput, ConsumptionFilters, JobType } from '@/modules/procurement/field-stock/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      // Special case: get consumptions for a drop
      if (req.query.dropNumber) {
        const consumptions = await getConsumptionsByDrop(req.query.dropNumber as string);
        return apiResponse.success(res, consumptions);
      }

      // Special case: get consumptions by technician
      if (req.query.technicianId) {
        const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined;
        const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : undefined;

        const consumptions = await getConsumptionsByTechnician(
          req.query.technicianId as string,
          dateFrom,
          dateTo
        );
        return apiResponse.success(res, consumptions);
      }

      // Special case: get unverified count
      if (req.query.countUnverified === 'true') {
        const count = await getUnverifiedCount();
        return apiResponse.success(res, { unverifiedCount: count });
      }

      // Build filters from query params
      const filters: ConsumptionFilters = {};

      if (req.query.jobType) {
        filters.jobType = req.query.jobType as JobType;
      }
      if (req.query.verified !== undefined) {
        filters.verified = req.query.verified === 'true';
      }
      if (req.query.dateFrom) {
        filters.dateFrom = new Date(req.query.dateFrom as string);
      }
      if (req.query.dateTo) {
        filters.dateTo = new Date(req.query.dateTo as string);
      }

      const consumptions = await getConsumptions(filters);
      return apiResponse.success(res, consumptions);
    }

    if (req.method === 'POST') {
      const input = req.body as RecordConsumptionInput;

      // Validate required fields
      if (!input.jobType || !input.stockItemId || !input.quantity || !input.consumedFromLocationId) {
        return apiResponse.validationError(res, { error: 'Missing required fields: jobType, stockItemId, quantity, consumedFromLocationId' });
      }

      // Job reference required for traceability
      if (input.jobType === 'drop' && !input.dropNumber) {
        return apiResponse.validationError(res, { dropNumber: 'Drop number is required for drop job type' });
      }
      if (input.jobType === 'home_install' && !input.homeInstallId) {
        return apiResponse.validationError(res, { homeInstallId: 'Home install ID is required for home_install job type' });
      }

      const consumption = await recordConsumption(input);
      return apiResponse.created(res, consumption);
    }

    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  } catch (error) {
    log.error('Field stock consumptions API error', error, 'field-stock/consumptions');
    return apiResponse.internalError(res, error);
  }
}
