/**
 * Field Stock Locations API
 * GET /api/procurement/field-stock/locations - List all locations
 * POST /api/procurement/field-stock/locations - Create a new location
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  getLocations,
  createLocation,
  getTechnicianLocations,
} from '@/modules/procurement/field-stock/services/locationService';
import type { CreateLocationInput, LocationFilters, LocationType } from '@/modules/procurement/field-stock/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      // Parse query parameters for filters
      const filters: LocationFilters = {};

      if (req.query.locationType) {
        filters.locationType = req.query.locationType as LocationType;
      }
      if (req.query.projectId) {
        filters.projectId = req.query.projectId as string;
      }
      if (req.query.isActive !== undefined) {
        filters.isActive = req.query.isActive === 'true';
      }
      if (req.query.parentId) {
        filters.parentId = req.query.parentId as string;
      }
      if (req.query.search) {
        filters.search = req.query.search as string;
      }

      // Special case: get technician locations only
      if (req.query.techniciansOnly === 'true') {
        const locations = await getTechnicianLocations();
        return apiResponse.success(res, locations);
      }

      const locations = await getLocations(filters);
      return apiResponse.success(res, locations);
    }

    if (req.method === 'POST') {
      const input = req.body as CreateLocationInput;

      // Validate required fields
      if (!input.code || !input.name || !input.locationType) {
        return apiResponse.validationError(res, { error: 'Missing required fields: code, name, locationType' });
      }

      const location = await createLocation(input);
      return apiResponse.created(res, location);
    }

    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  } catch (error) {
    log.error('Field stock locations API error', error, 'field-stock/locations');
    return apiResponse.internalError(res, error);
  }
}
