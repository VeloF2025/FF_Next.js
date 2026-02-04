/**
 * API: Fleet Check-In Template by ID
 * GET /api/fleet/check-in/templates/[templateId] - Get template with items
 * PUT /api/fleet/check-in/templates/[templateId] - Update template
 * DELETE /api/fleet/check-in/templates/[templateId] - Delete template
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
  getTemplateWithItems,
  updateTemplate,
  deleteTemplate,
} from '@/modules/fleet/services/checkInService';
import type { CreateTemplateInput } from '@/modules/fleet/types/check-in.types';
import { withFleetAuth } from '@/lib/auth/middleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { templateId } = req.query;

  if (!templateId || typeof templateId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Template ID is required');
  }

  try {
    switch (req.method) {
      case 'GET': {
        const template = await getTemplateWithItems(templateId);
        if (!template) {
          return apiResponse.notFound(res, 'Template', templateId);
        }
        return apiResponse.success(res, template);
      }

      case 'PUT': {
        const input = req.body as Partial<CreateTemplateInput>;
        const template = await updateTemplate(templateId, input);
        if (!template) {
          return apiResponse.notFound(res, 'Template', templateId);
        }
        return apiResponse.success(res, template);
      }

      case 'DELETE': {
        const deleted = await deleteTemplate(templateId);
        if (!deleted) {
          return apiResponse.notFound(res, 'Template', templateId);
        }
        return apiResponse.success(res, { deleted: true });
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
    }
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withFleetAuth(handler);
