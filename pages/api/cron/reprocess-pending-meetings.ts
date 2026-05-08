// Cron endpoint — reprocesses meetings with processing_status = 'pending'
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { processMeetingFromCallRecord } from '@/lib/graph/meeting-processor';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);
const LOGGER = 'ReprocessPendingCron';

/**
 * POST /api/cron/reprocess-pending-meetings
 *
 * Reprocesses all meetings with processing_status = 'pending' and a stored
 * teams_call_record_id. Designed for recovery after pipeline failures.
 *
 * Auth: CRON_SECRET bearer token.
 *
 * curl example:
 *   curl -X POST https://app.fibreflow.app/api/cron/reprocess-pending-meetings \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method!, ['POST']);
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET is not configured', {}, LOGGER);
    apiResponse.internalError(res, new Error('Server misconfiguration'));
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    log.warn(
      'Unauthorized cron attempt',
      { ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress },
      LOGGER
    );
    apiResponse.unauthorized(res);
    return;
  }

  const pending = await sql`
    SELECT id, teams_call_record_id
    FROM meetings
    WHERE processing_status = 'pending'
      AND teams_call_record_id IS NOT NULL
    ORDER BY meeting_date DESC
  ` as { id: number; teams_call_record_id: string }[];

  log.info('Reprocess pending cron triggered', { count: pending.length }, LOGGER);

  res.status(202).json({
    message: `Reprocessing ${pending.length} pending meetings in background`,
    meetingIds: pending.map(r => r.id),
  });

  setImmediate(async () => {
    let ok = 0;
    let fail = 0;

    for (const row of pending) {
      try {
        await processMeetingFromCallRecord(row.teams_call_record_id);
        ok++;
        log.info('Reprocessed meeting', {
          meetingId: row.id,
          callRecordId: row.teams_call_record_id,
          progress: `${ok + fail}/${pending.length}`,
        }, LOGGER);
      } catch (error: unknown) {
        fail++;
        const msg = error instanceof Error ? error.message : String(error);
        log.error('Reprocess failed', { meetingId: row.id, error: msg }, LOGGER);
      }
    }

    log.info('Reprocess pending cron complete', { total: pending.length, ok, fail }, LOGGER);
  });
}
