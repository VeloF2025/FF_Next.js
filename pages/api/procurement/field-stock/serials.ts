/**
 * Field Stock Serials API
 * GET /api/procurement/field-stock/serials - List serials with filters
 * POST /api/procurement/field-stock/serials - Register a new serial
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import {
  getSerials,
  registerSerial,
  getAvailableSerials,
  getSerialsByTechnician,
} from '@/modules/procurement/field-stock/services/serialService';
import type { RegisterSerialInput, SerialFilters, SerialStatus } from '@/modules/procurement/field-stock/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      // Special case: get available serials for an item
      if (req.query.available === 'true' && req.query.stockItemId) {
        const serials = await getAvailableSerials(req.query.stockItemId as string);
        return apiResponse.success(res, serials);
      }

      // Special case: get serials held by technician
      if (req.query.technicianLocationId) {
        const serials = await getSerialsByTechnician(req.query.technicianLocationId as string);
        return apiResponse.success(res, serials);
      }

      // Build filters from query params
      const filters: SerialFilters = {};

      if (req.query.stockItemId) {
        filters.stockItemId = req.query.stockItemId as string;
      }
      if (req.query.status) {
        filters.status = req.query.status as SerialStatus;
      }
      if (req.query.locationId) {
        filters.locationId = req.query.locationId as string;
      }
      if (req.query.installedAtDropNumber) {
        filters.installedAtDropNumber = req.query.installedAtDropNumber as string;
      }
      if (req.query.search) {
        filters.search = req.query.search as string;
      }

      const serials = await getSerials(filters);
      return apiResponse.success(res, serials);
    }

    if (req.method === 'POST') {
      const input = req.body as RegisterSerialInput;

      // Validate required fields
      if (!input.stockItemId || !input.serialNumber || !input.locationId) {
        return apiResponse.validationError(res, { error: 'Missing required fields: stockItemId, serialNumber, locationId' });
      }

      const serial = await registerSerial(input);
      return apiResponse.created(res, serial);
    }

    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  } catch (error) {
    log.error('Field stock serials API error', { error: error }, 'field-stock/serials');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
