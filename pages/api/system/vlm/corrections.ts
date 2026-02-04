/**
 * API: VLM Corrections
 *
 * GET /api/system/vlm/corrections - List corrections with filtering
 * POST /api/system/vlm/corrections - Record a new correction
 * PATCH /api/system/vlm/corrections - Update correction (mark canonical, etc.)
 * DELETE /api/system/vlm/corrections?id=xxx - Delete a correction
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import {
  listCorrections,
  recordVlmCorrection,
  markAsCanonical,
  deleteCorrection,
} from '@/services/vlmLearningService';
import type {
  VlmModule,
  VlmAnalysisType,
  ErrorPattern,
  CorrectionReason,
} from '@/types/vlm-learning';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const {
          module,
          analysisType,
          errorPattern,
          isCanonical,
          dateFrom,
          dateTo,
          limit = '50',
          offset = '0',
        } = req.query;

        const options = {
          module: module as VlmModule | undefined,
          analysisType: analysisType as VlmAnalysisType | undefined,
          errorPattern: errorPattern as ErrorPattern | undefined,
          isCanonical: isCanonical === 'true' ? true : isCanonical === 'false' ? false : undefined,
          dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
          dateTo: dateTo ? new Date(dateTo as string) : undefined,
          limit: parseInt(limit as string, 10) || 50,
          offset: parseInt(offset as string, 10) || 0,
        };

        const result = await listCorrections(options);

        return apiResponse.success(res, {
          corrections: result.corrections,
          total: result.total,
          hasMore: result.total > options.offset + result.corrections.length,
        });
      }

      case 'POST': {
        const {
          module,
          analysisType,
          sourceId,
          sourceTable,
          photoUrl,
          vlmExtractedValue,
          vlmConfidence,
          correctedValue,
          correctionReason,
          correctionNotes,
          context,
          correctedByName,
        } = req.body;

        if (!module || !analysisType || !correctedValue) {
          return apiResponse.error(
            res,
            ErrorCode.BAD_REQUEST,
            'module, analysisType, and correctedValue are required'
          );
        }

        const correction = await recordVlmCorrection({
          module: module as VlmModule,
          analysisType: analysisType as VlmAnalysisType,
          sourceId,
          sourceTable,
          photoUrl,
          vlmExtractedValue: vlmExtractedValue || null,
          vlmConfidence,
          correctedValue,
          correctionReason: correctionReason as CorrectionReason | undefined,
          correctionNotes,
          context,
          correctedByName,
        });

        log.info('VlmCorrectionsAPI', `Created correction: ${correction.id}`);
        return apiResponse.created(res, correction);
      }

      case 'PATCH': {
        const { id, isCanonical, priority } = req.body;

        if (!id) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Correction ID is required');
        }

        if (isCanonical !== undefined) {
          await markAsCanonical(id, isCanonical, priority);
          log.info('VlmCorrectionsAPI', `Updated correction ${id} canonical=${isCanonical}`);
        }

        return apiResponse.success(res, { id, updated: true });
      }

      case 'DELETE': {
        const { id } = req.query;

        if (!id || typeof id !== 'string') {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Correction ID is required');
        }

        await deleteCorrection(id);
        log.info('VlmCorrectionsAPI', `Deleted correction ${id}`);

        return apiResponse.success(res, { id, deleted: true });
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', [
          'GET',
          'POST',
          'PATCH',
          'DELETE',
        ]);
    }
  } catch (error) {
    log.error('VlmCorrectionsAPI', `Error: ${error}`);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler, { requiredRoles: ['admin', 'system_admin'] });
