// 🟢 WORKING: Stream a meeting recording MP4 with Range request support for video seeking
// Access restricted to meeting participants; hein@velocityfibre.co.za bypasses the check
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import * as fs from 'fs';

const sql = neon(process.env.DATABASE_URL!);

const LOGGER = 'RecordingAPI';

/** Shape of the meeting row returned by the recording queries */
interface MeetingRecordingRow {
  id: number;
  recording_path: string | null;
  recording_size_bytes: number | null;
  audio_url: string | null;
  video_url: string | null;
}

/**
 * GET /api/meetings/[id]/recording
 *
 * Streams the MP4 recording for a meeting with full Range request support,
 * enabling seek operations in standard HTML5 <video> elements.
 *
 * Access control:
 *   - hein@velocityfibre.co.za: unrestricted access
 *   - Other roles: must appear in the meeting's participants JSON array by email
 *
 * Supports:
 *   - Full file delivery (200 Content-Length)
 *   - Partial content via Range header (206 Content-Range) for video seeking
 */
async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authReq = req as AuthenticatedNextApiRequest;
  const userEmail = authReq.user?.email?.toLowerCase();
  const isOwner = userEmail === 'hein@velocityfibre.co.za';

  if (!userEmail) {
    res.status(403).json({ error: 'User email is required for recording access' });
    return;
  }

  const rawId = req.query.id;
  const meetingId = typeof rawId === 'string' ? Number(rawId) : NaN;

  if (isNaN(meetingId) || meetingId <= 0) {
    res.status(400).json({ error: 'Invalid meeting ID' });
    return;
  }

  try {
    // Fetch recording metadata with participant-based access control
    const rows = isOwner
      ? await sql`
          SELECT id, recording_path, recording_size_bytes, audio_url, video_url
          FROM meetings
          WHERE id = ${meetingId}
        `
      : await sql`
          SELECT id, recording_path, recording_size_bytes, audio_url, video_url
          FROM meetings
          WHERE id = ${meetingId}
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(participants) AS p
              WHERE LOWER(p->>'email') = ${userEmail}
            )
        `;

    const meeting = rows[0] as MeetingRecordingRow | undefined;

    if (!meeting) {
      // Return 403 rather than 404 to avoid leaking meeting existence to non-participants
      res.status(403).json({ error: 'Meeting not found or you are not a participant' });
      return;
    }

    // Fireflies meetings: return CDN URLs for client-side playback
    if (!meeting.recording_path && (meeting.video_url || meeting.audio_url)) {
      res.status(200).json({
        type: 'external',
        videoUrl: meeting.video_url || null,
        audioUrl: meeting.audio_url || null,
      });
      return;
    }

    if (!meeting.recording_path) {
      res.status(404).json({ error: 'No recording available for this meeting' });
      return;
    }

    if (!fs.existsSync(meeting.recording_path)) {
      log.warn(
        'Recording file missing from disk',
        { meetingId, path: meeting.recording_path },
        LOGGER
      );
      res.status(404).json({ error: 'Recording file not found on disk' });
      return;
    }

    const stat = fs.statSync(meeting.recording_path);
    const fileSize = stat.size;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      // Partial content response for Range requests (video seeking)
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0]!, 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).json({ error: 'Requested range not satisfiable' });
        return;
      }

      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });

      const stream = fs.createReadStream(meeting.recording_path, { start, end });
      stream.pipe(res);

      stream.on('error', (streamError: Error) => {
        log.error(
          'Recording stream error during Range read',
          { meetingId, error: streamError.message },
          LOGGER
        );
        // Headers already sent — cannot send a new error response
      });
    } else {
      // Full file delivery
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });

      const stream = fs.createReadStream(meeting.recording_path);
      stream.pipe(res);

      stream.on('error', (streamError: Error) => {
        log.error(
          'Recording stream error during full read',
          { meetingId, error: streamError.message },
          LOGGER
        );
      });
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Recording handler error', { meetingId, error: errorMsg }, LOGGER);
    res.status(500).json({ error: 'Failed to stream recording' });
  }
}

export default withAuth(handler);
