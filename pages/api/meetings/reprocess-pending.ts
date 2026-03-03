/**
 * POST /api/meetings/reprocess-pending
 *
 * Re-processes all meetings with processing_status = 'pending' and a
 * stored teams_call_record_id.  Unlike sync-teams (time-window limited),
 * this endpoint works by call-record ID so it can reach meetings of any age.
 *
 * Auth: admin / super_admin only.
 * Response: 202 Accepted immediately; processing continues in background.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { processMeetingFromCallRecord } from '@/lib/graph/meeting-processor';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const LOGGER = 'ReprocessPending';
const ALLOWED_ROLES = new Set(['admin', 'super_admin']);

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  if (!ALLOWED_ROLES.has(authReq.user?.role)) {
    return apiResponse.forbidden(res, 'Admin access required');
  }

  const pending = await sql`
    SELECT id, teams_call_record_id
    FROM meetings
    WHERE processing_status = 'pending'
      AND teams_call_record_id IS NOT NULL
    ORDER BY meeting_date DESC
  `;

  log.info('Reprocess pending started', { count: pending.length }, LOGGER);

  res.status(202).json({
    message: `Reprocessing ${pending.length} pending meetings in background`,
    meetingIds: pending.map(r => r.id),
  });

  setImmediate(async () => {
    let ok = 0;
    let fail = 0;

    for (const row of pending) {
      try {
        await processMeetingFromCallRecord(row.teams_call_record_id as string);
        ok++;
        log.info('Reprocessed', { meetingId: row.id, ok, fail, remaining: pending.length - ok - fail }, LOGGER);
      } catch (error: unknown) {
        fail++;
        const msg = error instanceof Error ? error.message : String(error);
        log.error('Reprocess failed', { meetingId: row.id, error: msg }, LOGGER);
      }
    }

    log.info('Reprocess complete', { total: pending.length, ok, fail }, LOGGER);
  });
}

export default withAuth(handler);
