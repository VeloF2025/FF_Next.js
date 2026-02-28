// 🟢 WORKING: Manual Teams sync trigger — admin only, fires and forgets in background
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { fetchRecentCallRecords } from '@/lib/graph/call-records';
import { processMeetingFromCallRecord } from '@/lib/graph/meeting-processor';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const LOGGER = 'TeamsSync';

/** Roles permitted to trigger a manual sync */
const ALLOWED_ROLES = new Set(['admin', 'super_admin']);

/** Default look-back window when `hours` is not provided in the request body */
const DEFAULT_HOURS = 24;

/**
 * POST /api/meetings/sync-teams
 *
 * Triggers a manual backfill of Teams call records from the last N hours.
 * Call records that already have a completed meeting row are skipped.
 *
 * Auth: admin or super_admin only.
 * Response: 202 Accepted immediately; processing continues in background.
 *
 * Body:
 *   hours?: number  — look-back window in hours (default: 24)
 */
async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userRole = authReq.user?.role;

  if (!ALLOWED_ROLES.has(userRole)) {
    return apiResponse.forbidden(res, 'Admin access required to trigger Teams sync');
  }

  const rawHours = req.body?.hours;
  const hours = rawHours !== undefined ? Number(rawHours) : DEFAULT_HOURS;

  if (isNaN(hours) || hours <= 0 || hours > 168) {
    return apiResponse.badRequest(res, 'hours must be a positive number between 1 and 168');
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  log.info(
    'Manual Teams sync triggered',
    { hours, since: since.toISOString(), triggeredBy: authReq.user?.email },
    LOGGER
  );

  // Respond 202 immediately so the caller does not wait for the full sync
  res.status(202).json({
    message: `Teams sync started for the last ${hours} hours`,
    since: since.toISOString(),
  });

  // Process in background — errors are logged, not surfaced to the caller
  setImmediate(async () => {
    try {
      const records = await fetchRecentCallRecords(since);

      log.info(
        'Teams sync: call records fetched',
        { count: records.length, since: since.toISOString() },
        LOGGER
      );

      let processed = 0;
      let skipped = 0;
      let failed = 0;

      for (const record of records) {
        // Skip records that already have a completed meeting row
        const existing = await sql`
          SELECT id
          FROM meetings
          WHERE teams_call_record_id = ${record.id}
            AND processing_status = 'completed'
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
            'Teams sync: failed to process call record',
            { callRecordId: record.id, error: errorMsg },
            LOGGER
          );
        }
      }

      log.info(
        'Teams sync complete',
        { total: records.length, processed, skipped, failed },
        LOGGER
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('Teams sync background job failed', { error: errorMsg }, LOGGER);
    }
  });
}

export default withAuth(handler);
