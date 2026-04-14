// 🟢 WORKING: Full re-sync of a Teams meeting — re-fetches transcript + recording from Graph, then re-runs LLM
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { processMeetingFromCallRecord } from '@/lib/graph/meeting-processor';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const LOGGER = 'MeetingResync';

const ALLOWED_ROLES = new Set(['admin', 'super_admin']);

/**
 * POST /api/meetings/[id]/resync
 *
 * Re-runs the full Teams pipeline for a single meeting:
 *   1. Looks up the teams_call_record_id from the meeting row
 *   2. Calls processMeetingFromCallRecord() — transcript fetch, recording download, LLM enrichment
 *
 * Use when Microsoft hadn't finished processing the recording/transcript
 * at the time the meeting was originally synced.
 *
 * Auth: admin or super_admin only.
 * Only works for teams-sourced meetings.
 * Returns 202 immediately; processing continues in background.
 */
async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userRole = authReq.user?.role;

  if (!ALLOWED_ROLES.has(userRole)) {
    return apiResponse.forbidden(res, 'Admin access required to re-sync meetings');
  }

  const rawId = req.query.id;
  const meetingId = typeof rawId === 'string' ? Number(rawId) : NaN;

  if (isNaN(meetingId) || meetingId <= 0) {
    return apiResponse.badRequest(res, 'Invalid meeting ID');
  }

  const rows = await sql`
    SELECT id, title, source, teams_call_record_id
    FROM meetings
    WHERE id = ${meetingId}
  `;

  const meeting = rows[0] as { id: number; title: string; source: string; teams_call_record_id: string | null } | undefined;

  if (!meeting) {
    return apiResponse.notFound(res, 'Meeting', meetingId);
  }

  if (meeting.source !== 'teams') {
    return apiResponse.badRequest(res, 'Re-sync is only available for Teams meetings');
  }

  if (!meeting.teams_call_record_id) {
    return apiResponse.badRequest(res, 'Meeting has no Teams call record ID — cannot re-sync');
  }

  log.info(
    'Meeting re-sync requested',
    {
      meetingId,
      title: meeting.title,
      callRecordId: meeting.teams_call_record_id,
      requestedBy: authReq.user?.email,
    },
    LOGGER
  );

  // Respond 202 immediately — processing continues in background
  res.status(202).json({
    message: `Re-sync started for meeting ${meetingId}`,
    meetingId,
  });

  setImmediate(async () => {
    try {
      await processMeetingFromCallRecord(meeting.teams_call_record_id!);
      log.info('Meeting re-sync complete', { meetingId }, LOGGER);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('Meeting re-sync failed', { meetingId, error: errorMsg }, LOGGER);
    }
  });
}

export default withAuth(handler);
