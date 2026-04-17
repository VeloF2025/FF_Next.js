/**
 * Vercel Cron: Action Centre weekly recon
 *
 * RFC Phase 6. Runs the scanners that find patterns the event-driven
 * rule engine doesn't catch (runs of consecutive weeks, stale tickets,
 * stale pre-provisions). Scheduled weekly — fires every Monday 04:00 UTC
 * (≈ 06:00 SAST) so anomalies land in the dashboard before the Monday
 * morning stand-up.
 *
 * Query params:
 *   dryRun=true → scanners run read-only, no events emitted.
 *   minWeeks=N  → override the persistent-note threshold (default 3).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { scanPersistentNotes } from '@/modules/activate/services/action-centre-scanners/persistentNoteScanner';
import { scanMaintenanceReopens } from '@/modules/activate/services/action-centre-scanners/maintenanceReopenScanner';
import { scanStalePp } from '@/modules/activate/services/action-centre-scanners/stalePpScanner';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.error('cronTask', { action: 'action-centre-weekly-recon', error: 'CRON_SECRET not configured' });
    return apiResponse.internalError(res, new Error('CRON_SECRET not configured'));
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    log.error('cronTask', { action: 'action-centre-weekly-recon', error: 'Unauthorized request' });
    return apiResponse.unauthorized(res);
  }

  const dryRun = String(req.query.dryRun || '').toLowerCase() === 'true';
  const minWeeks = Math.max(2, Number(req.query.minWeeks) || 3);
  const stalePpDays = Math.max(7, Number(req.query.stalePpDays) || 30);
  // Lookback for maintenance reopens — weekly cron uses a full week.
  const maintLookbackHours = 168;

  log.info('cronTask', {
    action: 'action-centre-weekly-recon',
    step: 'start',
    dryRun,
    minWeeks,
    stalePpDays,
  });

  try {
    if (dryRun) {
      // Dry run: no scanner mutates state. Report that everything
      // would have executed.
      return apiResponse.success(res, {
        dryRun: true,
        persistent: { note: 'skipped in dry-run' },
        maintenance: { note: 'skipped in dry-run' },
        stalePp:    { note: 'skipped in dry-run' },
      });
    }

    const [persistent, maintenance, stalePp] = await Promise.all([
      scanPersistentNotes(minWeeks),
      scanMaintenanceReopens(maintLookbackHours),
      scanStalePp(stalePpDays),
    ]);

    log.info('cronTask', {
      action: 'action-centre-weekly-recon',
      step: 'done',
      persistent,
      maintenance,
      stalePp,
    });

    return apiResponse.success(res, { persistent, maintenance, stalePp });
  } catch (err) {
    log.error('cronTask', {
      action: 'action-centre-weekly-recon',
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}
