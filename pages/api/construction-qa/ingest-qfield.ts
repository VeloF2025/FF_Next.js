/**
 * POST /api/construction-qa/ingest-qfield
 *
 * Triggers ingestion of QField photos into the Construction QA system.
 * Reads from qfield_photo_validations and creates review + photo records.
 *
 * Body: { projectId, discipline?, sinceDate?, dryRun? }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { ingestQFieldPhotos } from '@/modules/construction-qa/services/qfieldIngestionService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['POST']);
  }

  try {
    const { projectId, discipline, sinceDate, dryRun } = req.body;

    if (!projectId) {
      return apiResponse.badRequest(res, 'projectId is required');
    }

    const result = await ingestQFieldPhotos({
      projectId,
      discipline: discipline || 'all',
      sinceDate,
      dryRun: Boolean(dryRun),
    });

    return apiResponse.success(res, {
      projectId,
      ...result,
      dryRun: Boolean(dryRun),
    });
  } catch (error) {
    log.error('Ingest API error', { module: 'construction-qa', error: (error as Error).message });
    return apiResponse.internalError(res, error);
  }
}
