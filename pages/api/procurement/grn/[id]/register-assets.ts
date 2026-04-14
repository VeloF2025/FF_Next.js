/**
 * GRN Asset Registration API
 *
 * GET  /api/procurement/grn/[id]/register-assets - Get registrable items from GRN
 * POST /api/procurement/grn/[id]/register-assets - Register assets from GRN
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  getGrnForRegistration,
  batchRegisterFromGrn,
  type RegisterAssetInput,
} from '@/modules/assets/services/assetRegistrationService';
import { z } from 'zod';

// Validation schema for registration request
const RegisterAssetsSchema = z.object({
  items: z.array(
    z.object({
      grnItemId: z.string().uuid(),
      serialNumber: z.string().min(1),
      categoryId: z.string().uuid(),
      name: z.string().optional(),
      manufacturer: z.string().optional(),
      model: z.string().optional(),
      labelImageUrl: z.string().url().optional(),
    })
  ).min(1, 'At least one item required'),
});

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { id: grnId } = req.query;

  if (!grnId || typeof grnId !== 'string') {
    return apiResponse.badRequest(res, 'GRN ID is required');
  }

  // GET: Get GRN with registrable items
  if (req.method === 'GET') {
    try {
      const grn = await getGrnForRegistration(grnId);

      if (!grn) {
        return apiResponse.notFound(res, 'GRN', grnId);
      }

      // Filter to only show registrable items
      const registrableItems = grn.items.filter((item) => {
        const pendingCount = item.quantityAccepted - item.registeredCount;
        return item.requiresRegistration && pendingCount > 0;
      });

      return apiResponse.success(res, {
        grn: {
          id: grn.grnId,
          grnNumber: grn.grnNumber,
          status: grn.status,
          deliveryDate: grn.deliveryDate,
          supplier: {
            id: grn.supplierId,
            name: grn.supplierName,
          },
          po: grn.poId ? { id: grn.poId, number: grn.poNumber } : null,
          warehouse: {
            id: grn.warehouseId,
            name: grn.warehouseName,
          },
        },
        items: registrableItems,
        totalRegistrable: registrableItems.length,
        hasRegistrableItems: registrableItems.length > 0,
      });
    } catch (error) {
      log.error('[API] Failed to get GRN for registration', {
        grnId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return apiResponse.error(res, 'Failed to get GRN registration data');
    }
  }

  // POST: Register assets from GRN
  if (req.method === 'POST') {
    try {
      // Validate request body
      const validation = RegisterAssetsSchema.safeParse(req.body);
      if (!validation.success) {
        return apiResponse.badRequest(res, 'Invalid request', validation.error.errors);
      }

      const { items } = validation.data;
      const userId = req.user?.email || 'system';

      // Check GRN exists and is completed
      const grn = await getGrnForRegistration(grnId);
      if (!grn) {
        return apiResponse.notFound(res, 'GRN', grnId);
      }

      if (grn.status !== 'completed') {
        return apiResponse.badRequest(
          res,
          `Cannot register assets from GRN with status "${grn.status}". GRN must be completed.`
        );
      }

      log.info('[API] Registering assets from GRN', {
        grnId,
        grnNumber: grn.grnNumber,
        itemCount: items.length,
        userId,
      });

      // Perform batch registration
      const result = await batchRegisterFromGrn(grnId, items as RegisterAssetInput[], userId);

      log.info('[API] Asset registration complete', {
        grnId,
        batchId: result.batchId,
        registered: result.registered.length,
        skipped: result.skipped.length,
        errors: result.errors.length,
      });

      return apiResponse.success(res, {
        success: result.success,
        batchId: result.batchId,
        summary: {
          total: items.length,
          registered: result.registered.length,
          skipped: result.skipped.length,
          errors: result.errors.length,
        },
        registered: result.registered,
        skipped: result.skipped,
        errors: result.errors,
      });
    } catch (error) {
      log.error('[API] Failed to register assets from GRN', {
        grnId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return apiResponse.error(res, 'Failed to register assets');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(withErrorHandler(handler));
