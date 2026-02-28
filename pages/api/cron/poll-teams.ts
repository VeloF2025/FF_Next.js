// 🟢 WORKING: Fallback cron — polls Teams call records every 15 min via CRON_SECRET
// Used as a safety net when Graph webhook subscriptions lapse or miss events
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { fetchRecentCallRecords } from '@/lib/graph/call-records';
import { processMeetingFromCallRecord } from '@/lib/graph/meeting-processor';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const LOGGER = 'TeamsCron';

/** Look-back window — covers two cron intervals with overlap for safety */
const POLL_WINDOW_MINUTES = 60;

/**
 * POST /api/cron/poll-teams
 *
 * Polls the Graph callRecords API for the last POLL_WINDOW_MINUTES and processes
 * any call records that do not yet have a meetings row.
 *
 * Auth: CRON_SECRET bearer token (same pattern as meetings-sync-cron.ts).
 * Schedule: every 15 minutes via system cron or Vercel Cron.
 *
 * curl example:
 *   curl -X POST https://app.fibreflow.app/api/cron/poll-teams \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.error('CRON_SECRET is not configured', {}, LOGGER);
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    log.warn(
      'Unauthorized cron attempt',
      { ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress },
      LOGGER
    );
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const since = new Date(Date.now() - POLL_WINDOW_MINUTES * 60 * 1000);
    const records = await fetchRecentCallRecords(since);

    log.info(
      'Teams poll: call records fetched',
      { count: records.length, since: since.toISOString() },
      LOGGER
    );

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const record of records) {
      // Any non-failed status means we have already attempted this record
      const existing = await sql`
        SELECT id
        FROM meetings
        WHERE teams_call_record_id = ${record.id}
      `;

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      try {
        const meetingId = await processMeetingFromCallRecord(record.id);
        if (meetingId > 0) processed++;
      } catch (error: unknown) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error(
          'Teams poll: failed to process call record',
          { callRecordId: record.id, error: errorMsg },
          LOGGER
        );
      }
    }

    log.info(
      'Teams poll cron complete',
      { total: records.length, processed, skipped, failed },
      LOGGER
    );

    res.status(200).json({
      success: true,
      fetched: records.length,
      processed,
      skipped,
      failed,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Teams poll cron failed', { error: errorMsg }, LOGGER);
    res.status(500).json({ success: false, error: errorMsg });
  }
}
