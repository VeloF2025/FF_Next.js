/**
 * API: Fleet Check-In Templates
 * GET /api/fleet/check-in/templates - List all templates
 * GET /api/fleet/check-in/templates?default=true&checkType=daily - Get default by type
 * POST /api/fleet/check-in/templates - Create a template
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
  getTemplates,
  getDefaultTemplate,
  getDefaultTemplateByType,
  getTemplatesByType,
  createTemplate,
} from '@/modules/fleet/services/checkInService';
import type { CreateTemplateInput, CheckType } from '@/modules/fleet/types/check-in.types';
import { withFleetAuth } from '@/lib/auth/middleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const { default: getDefault, checkType } = req.query;

        // Get default template by check type
        if (getDefault === 'true') {
          if (checkType && (checkType === 'daily' || checkType === 'weekly')) {
            const template = await getDefaultTemplateByType(checkType as CheckType);
            if (!template) {
              return apiResponse.notFound(res, `Default ${checkType} template`);
            }
            return apiResponse.success(res, template);
          }
          // Fallback to old behavior
          const template = await getDefaultTemplate();
          if (!template) {
            return apiResponse.notFound(res, 'Default template');
          }
          return apiResponse.success(res, template);
        }

        // Get templates by check type
        if (checkType && (checkType === 'daily' || checkType === 'weekly')) {
          const templates = await getTemplatesByType(checkType as CheckType);
          return apiResponse.success(res, templates);
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

export default withFleetAuth(handler);
