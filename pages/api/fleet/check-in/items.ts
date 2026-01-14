/**
 * API: Fleet Check-In Items
 * GET /api/fleet/check-in/items?templateId=xxx - List items for a template
 * POST /api/fleet/check-in/items - Create an item
 * PUT /api/fleet/check-in/items/reorder - Reorder items
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
  getItemsForTemplate,
  createCheckItem,
  reorderCheckItems,
} from '@/modules/fleet/services/checkInService';
import type { CreateCheckItemInput } from '@/modules/fleet/types/check-in.types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const { templateId } = req.query;

        if (!templateId || typeof templateId !== 'string') {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Template ID is required');
        }

        const items = await getItemsForTemplate(templateId);
        return apiResponse.success(res, items);
      }

      case 'POST': {
        const input = req.body as CreateCheckItemInput;

        if (!input.templateId) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Template ID is required');
        }
        if (!input.name) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Item name is required');
        }

        const item = await createCheckItem(input);
        return apiResponse.created(res, item);
      }

      case 'PUT': {
        // Reorder items
        const { templateId, itemIds } = req.body;

        if (!templateId || !itemIds || !Array.isArray(itemIds)) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Template ID and item IDs array are required');
        }

        await reorderCheckItems(templateId, itemIds);
        return apiResponse.success(res, { reordered: true });
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT']);
    }
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
