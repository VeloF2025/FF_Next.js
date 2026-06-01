/**
 * POST /api/cron/ont-serials-sync
 *
 * Protected cron endpoint — pulls the Velocity-maintained "ONT & Gizzu Serials"
 * master workbook from SharePoint and receives any new serials into stock
 * (issue #1864 recurring intake).
 *
 * Authentication: x-cron-secret: {CRON_SECRET}
 *
 * Suggested schedule (Velocity crontab, SAST), alongside the Fibertime pulls:
 *   15 22 * * *  curl -s -X POST https://app.fibreflow.app/api/cron/ont-serials-sync \
 *                  -H "x-cron-secret: $CRON_SECRET"
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db-pool';
import { syncOntSerialsFromSharePoint } from '@/modules/procurement/field-stock/services/ontSerialSync';

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', {}, 'ont-serials-sync');
    return apiResponse.internalError(res, new Error('Server misconfiguration'));
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    log.warn(
      'Unauthorised ONT serial sync attempt',
      { ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '') },
      'ont-serials-sync',
    );
    return apiResponse.unauthorized(res, 'Invalid or missing x-cron-secret header');
  }

  try {
    log.info('ONT serial SharePoint sync triggered', {}, 'ont-serials-sync');
    const report = await syncOntSerialsFromSharePoint(pool);
    return apiResponse.success(res, report, 'ONT serial sync complete') as unknown as void;
  } catch (error) {
    log.error('ONT serial sync failed', { error }, 'ont-serials-sync');
    return apiResponse.internalError(res, error, 'ONT serial sync failed');
  }
}
