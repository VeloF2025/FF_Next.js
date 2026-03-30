/**
 * POST /api/construction-qa/ingest-qfield
 *
 * Triggers ingestion of QField photos into the Construction QA system.
 * Reads from qfield_photo_validations and creates review + photo records.
 *
 * Auth: x-cron-secret header required (server-to-server cron endpoint only).
 * Cookie fallback has been removed — presence of any browser cookie would
 * have bypassed the CRON_SECRET check entirely.
 *
 * Body: { projectId?, discipline?, sinceDate?, dryRun? }
 *   - projectId: FibreFlow project UUID (optional — omit to ingest ALL mapped projects)
 *   - discipline: 'civil' | 'optical' | 'all' (default: 'all')
 *   - sinceDate: ISO date string to filter photos (optional)
 *   - dryRun: boolean (default: false)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { ingestQFieldPhotos, ingestAllQFieldPhotos } from '@/modules/construction-qa/services/qfieldIngestionService';

const CRON_SECRET = process.env.CRON_SECRET || '';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['POST']);
  }

  // Auth: CRON_SECRET only — this is a server-to-server endpoint.
  // The cookie fallback was removed because any authenticated browser session
  // would bypass the secret check, exposing mass-ingest to web users.
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== CRON_SECRET) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  try {
    const { projectId, discipline, sinceDate, dryRun } = req.body;

    if (!projectId) {
      // Ingest all mapped projects
      const result = await ingestAllQFieldPhotos({
        discipline: discipline || 'all',
        dryRun: Boolean(dryRun),
      });
      return apiResponse.success(res, { mode: 'all', dryRun: Boolean(dryRun), ...result });
    }

    const result = await ingestQFieldPhotos({
      projectId,
      discipline: discipline || 'all',
      sinceDate,
      dryRun: Boolean(dryRun),
    });

    return apiResponse.success(res, { mode: 'single', dryRun: Boolean(dryRun), ...result });
  } catch (error) {
    log.error('Ingest API error', { module: 'construction-qa', error: (error as Error).message });
    return apiResponse.internalError(res, error);
  }
}

export default handler;
