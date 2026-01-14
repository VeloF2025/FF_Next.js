/**
 * API: Fleet Check-In Templates
 * GET /api/fleet/check-in/templates - List all templates
 * POST /api/fleet/check-in/templates - Create a template
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
  getTemplates,
  getDefaultTemplate,
  createTemplate,
} from '@/modules/fleet/services/checkInService';
import type { CreateTemplateInput } from '@/modules/fleet/types/check-in.types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const { default: getDefault } = req.query;

        if (getDefault === 'true') {
          const template = await getDefaultTemplate();
          if (!template) {
            return apiResponse.notFound(res, 'Default template');
          }
          return apiResponse.success(res, template);
        }

        const templates = await getTemplates();
        return apiResponse.success(res, templates);
      }

      case 'POST': {
        const input = req.body as CreateTemplateInput;

        if (!input.name) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Template name is required');
        }

        const template = await createTemplate(input);
        return apiResponse.created(res, template);
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
