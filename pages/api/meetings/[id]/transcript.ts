// 🟢 WORKING: Retrieve transcript for a specific meeting (VTT or plain text)
// Access is restricted to meeting participants; super_admin bypasses the check
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { neon } from '@neondatabase/serverless';
import { parseVttSpeakers } from '@/lib/graph/transcripts';

const sql = neon(process.env.DATABASE_URL!);

/** Shape of a meetings row as returned by the participant-filtered query */
interface MeetingTranscriptRow {
  id: number;
  raw_transcript: string | null;
  participants: string | null;
}

/** Shape of a meeting_transcripts fallback row */
interface StoredTranscriptRow {
  content: string;
  format: string;
}

/**
 * GET /api/meetings/[id]/transcript
 *
 * Returns the transcript for a meeting in both raw and structured (speaker-parsed) form.
 *
 * Access control:
 *   - super_admin: unrestricted access
 *   - Other roles: must appear in the meeting's participants JSON array by email
 *
 * Response body:
 *   meetingId  — numeric meeting ID
 *   transcript — raw VTT or plain text string
 *   format     — 'vtt' | 'text'
 *   structured — parsed utterances (non-null only for VTT format)
 */
async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userEmail = authReq.user?.email?.toLowerCase();
  const userRole = authReq.user?.role;
  const isSuperAdmin = userRole === 'super_admin';

  if (!userEmail) {
    return apiResponse.forbidden(res, 'User email is required for transcript access');
  }

  const rawId = req.query.id;
  const meetingId = typeof rawId === 'string' ? Number(rawId) : NaN;

  if (isNaN(meetingId) || meetingId <= 0) {
    return apiResponse.badRequest(res, 'Invalid meeting ID');
  }

  try {
    // Fetch meeting row — super_admin gets unconditional access, others require participant match
    const rows = isSuperAdmin
      ? await sql`
          SELECT id, raw_transcript, participants
          FROM meetings
          WHERE id = ${meetingId}
        `
      : await sql`
          SELECT id, raw_transcript, participants
          FROM meetings
          WHERE id = ${meetingId}
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(participants) AS p
              WHERE LOWER(p->>'email') = ${userEmail}
            )
        `;

    const meeting = rows[0] as MeetingTranscriptRow | undefined;

    if (!meeting) {
      // Return 403 rather than 404 to avoid leaking meeting existence to non-participants
      return apiResponse.forbidden(res, 'Meeting not found or you are not a participant');
    }

    // Resolve transcript: inline column first, then meeting_transcripts fallback
    let transcript: string | null = (meeting.raw_transcript as string | null) ?? null;
    let format = 'text';

    if (!transcript) {
      const fallback = await sql`
        SELECT content, format
        FROM meeting_transcripts
        WHERE meeting_id = ${meetingId}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const fallbackRow = fallback[0] as StoredTranscriptRow | undefined;
      if (fallbackRow) {
        transcript = fallbackRow.content;
        format = fallbackRow.format ?? 'text';
      }
    }

    if (!transcript) {
      return apiResponse.notFound(res, 'Transcript', meetingId);
    }

    // Parse VTT into structured utterances for client convenience
    const structured = format === 'vtt' ? parseVttSpeakers(transcript) : null;

    return apiResponse.success(res, {
      meetingId,
      transcript,
      format,
      structured,
    });
  } catch (error: unknown) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
