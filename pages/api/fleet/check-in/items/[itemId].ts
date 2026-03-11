/**
 * API: Fleet Check-In Item by ID
 * PUT /api/fleet/check-in/items/[itemId] - Update an item
 * DELETE /api/fleet/check-in/items/[itemId] - Delete an item
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
  updateCheckItem,
  deleteCheckItem,
} from '@/modules/fleet/services/checkInService';
import type { CreateCheckItemInput } from '@/modules/fleet/types/check-in.types';
import { withFleetAuth } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { itemId } = req.query;

  if (!itemId || typeof itemId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Item ID is required');
  }

  try {
    switch (req.method) {
      case 'PUT': {
        const input = req.body as Partial<Omit<CreateCheckItemInput, 'templateId'>>;
        const item = await updateCheckItem(itemId, input);
        if (!item) {
          return apiResponse.notFound(res, 'Check item', itemId);
        }
        return apiResponse.success(res, item);
      }

      case 'DELETE': {
        const deleted = await deleteCheckItem(itemId);
        if (!deleted) {
          return apiResponse.notFound(res, 'Check item', itemId);
        }
        return apiResponse.success(res, { deleted: true });
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['PUT', 'DELETE']);
    }
  } catch (error) {
    log.error('ItemidApi', 'Internal error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withFleetAuth(handler);
