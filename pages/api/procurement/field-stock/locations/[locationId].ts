/**
 * Field Stock Location by ID API
 * GET /api/procurement/field-stock/locations/[locationId] - Get location details
 * PUT /api/procurement/field-stock/locations/[locationId] - Update location
 * DELETE /api/procurement/field-stock/locations/[locationId] - Delete location
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import {
  getLocationById,
  updateLocation,
  deleteLocation,
} from '@/modules/procurement/field-stock/services/locationService';
import type { UpdateLocationInput } from '@/modules/procurement/field-stock/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { locationId } = req.query;

  if (!locationId || typeof locationId !== 'string') {
    return apiResponse.validationError(res, { locationId: 'Location ID is required' });
  }

  try {
    if (req.method === 'GET') {
      const location = await getLocationById(locationId);
      if (!location) {
        return apiResponse.notFound(res, 'Location', locationId);
      }
      return apiResponse.success(res, location);
    }

    if (req.method === 'PUT') {
      const input = req.body as UpdateLocationInput;
      const location = await updateLocation(locationId, input);
      return apiResponse.success(res, location);
    }

    if (req.method === 'DELETE') {
      try {
        await deleteLocation(locationId);
        return apiResponse.success(res, { message: 'Location deleted successfully' });
      } catch (err) {
        const locErr = err as Error & { code?: string };
        if (locErr.code === 'LOCATION_NOT_EMPTY') {
          log.warn('Location delete rejected: location still holds stock', { locationId, reason: locErr.message }, 'field-stock/locations/[id]');
          return apiResponse.badRequest(res, locErr.message);
        }
        throw err;
      }
    }

    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
  } catch (error) {
    log.error('Field stock location API error', { error: error }, 'field-stock/locations/[id]');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
