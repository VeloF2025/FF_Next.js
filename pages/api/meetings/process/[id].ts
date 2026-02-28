// 🟢 WORKING: Re-run LLM processing on an existing meeting — admin only
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { processWithLLM } from '@/lib/llm/meeting-processor';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const LOGGER = 'MeetingReprocess';

/** Roles permitted to trigger LLM re-processing */
const ALLOWED_ROLES = new Set(['admin', 'super_admin']);

/** Minimal meeting row needed to confirm existence */
interface MeetingExistsRow {
  id: number;
  title: string | null;
  processing_status: string;
}

/**
 * POST /api/meetings/process/[id]
 *
 * Re-runs LLM enrichment on an already-ingested meeting.
 * Useful when:
 *   - The LLM prompt has been updated
 *   - A previous run failed and the transcript is now available
 *   - The meeting content was manually corrected
 *
 * Auth: admin or super_admin only.
 *
 * On success: returns the new MeetingSummary.
 * On failure: sets processing_status = 'failed' and returns 500.
 */
async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userRole = authReq.user?.role;

  if (!ALLOWED_ROLES.has(userRole)) {
    return apiResponse.forbidden(res, 'Admin access required to re-process meetings');
  }

  const rawId = req.query.id;
  const meetingId = typeof rawId === 'string' ? Number(rawId) : NaN;

  if (isNaN(meetingId) || meetingId <= 0) {
    return apiResponse.badRequest(res, 'Invalid meeting ID');
  }

  try {
    // Confirm the meeting exists before changing its status
    const rows = await sql`
      SELECT id, title, processing_status
      FROM meetings
      WHERE id = ${meetingId}
    `;

    const meeting = rows[0] as MeetingExistsRow | undefined;

    if (!meeting) {
      return apiResponse.notFound(res, 'Meeting', meetingId);
    }

    log.info(
      'Meeting re-processing requested',
      {
        meetingId,
        title: meeting.title,
        previousStatus: meeting.processing_status,
        requestedBy: authReq.user?.email,
      },
      LOGGER
    );

    // Mark as processing before calling the LLM to surface in-progress state
    await sql`
      UPDATE meetings
      SET processing_status = 'processing',
          processing_error  = NULL,
          updated_at        = NOW()
      WHERE id = ${meetingId}
    `;

    const summary = await processWithLLM(meetingId);

    log.info(
      'Meeting re-processed successfully',
      {
        meetingId,
        actionItems: summary.action_items.length,
        decisions: summary.decisions?.length ?? 0,
      },
      LOGGER
    );

    return apiResponse.success(res, { meetingId, summary });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Meeting re-processing failed', { meetingId, error: errorMsg }, LOGGER);

    // Persist failure state so it is visible in the meetings list
    await sql`
      UPDATE meetings
      SET processing_status = 'failed',
          processing_error  = ${errorMsg},
          updated_at        = NOW()
      WHERE id = ${meetingId}
    `.catch((dbErr: unknown) => {
      // Best-effort — do not mask the original error
      log.error(
        'Failed to persist failed status',
        { meetingId, error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
        LOGGER
      );
    });

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
