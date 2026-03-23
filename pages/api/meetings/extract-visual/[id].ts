/**
 * POST /api/meetings/extract-visual/[id]
 *
 * Triggers visual action item extraction for a meeting recording.
 * Extracts frames from the MP4, runs VLM analysis, merges with
 * transcript-based items via GPT-4o, and persists results.
 *
 * Auth: admin or super_admin only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { processVisualActionItems } from '@/lib/llm/visual-action-items';
import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';

const sql = neon(process.env.DATABASE_URL!);
const LOGGER = 'VisualExtractAPI';
const ALLOWED_ROLES = new Set(['admin', 'super_admin']);

interface MeetingRow {
  id: number;
  title: string | null;
  recording_path: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userRole = authReq.user?.role;

  if (!ALLOWED_ROLES.has(userRole)) {
    return apiResponse.forbidden(res, 'Admin access required');
  }

  const meetingId = parseInt(req.query.id as string, 10);
  if (isNaN(meetingId)) {
    return apiResponse.badRequest(res, 'Invalid meeting ID');
  }

  const rows = await sql`
    SELECT id, title, recording_path FROM meetings WHERE id = ${meetingId}
  ` as MeetingRow[];

  const meeting = rows[0];
  if (!meeting) {
    return apiResponse.notFound(res, 'Meeting', meetingId);
  }

  if (!meeting.recording_path) {
    return apiResponse.badRequest(res, 'Meeting has no recording');
  }

  if (!fs.existsSync(meeting.recording_path)) {
    return apiResponse.badRequest(res, `Recording file not found: ${meeting.recording_path}`);
  }

  log.info('Visual extraction triggered', {
    meetingId,
    title: meeting.title,
    recording: meeting.recording_path,
    triggeredBy: authReq.user?.email,
  }, LOGGER);

  // Respond 202 immediately — processing continues in background
  res.status(202).json({
    message: `Visual extraction started for meeting ${meetingId}`,
    meetingId,
  });

  // Process in background
  setImmediate(async () => {
    try {
      const result = await processVisualActionItems(meetingId, meeting.recording_path!);
      log.info('Visual extraction complete', { meetingId, ...result.stats }, LOGGER);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('Visual extraction failed', { meetingId, error: errorMsg }, LOGGER);
    }
  });
}

export default withAuth(handler);
