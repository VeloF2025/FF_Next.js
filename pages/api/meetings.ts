import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { syncFirefliesToNeon } from '@/services/fireflies/firefliesService';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get user info for access control
  const authReq = req as AuthenticatedNextApiRequest;
  const userEmail = authReq.user?.email?.toLowerCase();
  const userName = authReq.user?.name?.toLowerCase() || '';
  const isHein = userEmail === 'hein@velocityfibre.co.za';

  if (!userEmail) {
    return res.status(403).json({ error: 'User email required for meeting access' });
  }

  if (req.method === 'GET') {
    try {
      // Check if requesting a specific meeting by ID
      const { id, source } = req.query;

      if (id) {
        // Super admin can access any meeting, others need to be participants
        const [meeting] = isHein
          ? await sql`
              SELECT
                id, fireflies_id, title, meeting_date as date, duration,
                transcript_url, summary, participants, created_at, updated_at,
                source, processing_status, organizer_name, organizer_email, join_url,
                user_notes,
                (raw_transcript IS NOT NULL OR transcript_url IS NOT NULL OR EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = meetings.id)) as has_transcript,
                (recording_path IS NOT NULL) as has_recording
              FROM meetings
              WHERE id = ${id}
            `
          : await sql`
              SELECT
                id, fireflies_id, title, meeting_date as date, duration,
                transcript_url, summary, participants, created_at, updated_at,
                source, processing_status, organizer_name, organizer_email, join_url,
                user_notes,
                (raw_transcript IS NOT NULL OR transcript_url IS NOT NULL OR EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = meetings.id)) as has_transcript,
                (recording_path IS NOT NULL) as has_recording
              FROM meetings
              WHERE id = ${id}
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(participants) AS p
                WHERE LOWER(p->>'email') = ${userEmail}
                   OR LOWER(p->>'name') = ${userName}
                   OR LOWER(p->>'displayName') = ${userName}
              )
            `;

        if (!meeting) {
          return res.status(403).json({ error: 'Not authorized to view this meeting' });
        }

        return res.status(200).json({ meeting });
      }

      // Pagination params
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
      const offset = (page - 1) * limit;

      // Source filter: ?source=teams|fireflies|all (default: all)
      const sourceFilter = typeof source === 'string' && source !== 'all' ? source : null;

      // Get total count + paginated meetings
      // Super admin sees all meetings, others only see meetings they participated in
      let meetings;
      let totalRows;

      if (sourceFilter) {
        if (isHein) {
          totalRows = await sql`SELECT COUNT(*) as cnt FROM meetings WHERE source = ${sourceFilter}`;
          meetings = await sql`
            SELECT
              id, fireflies_id, title, meeting_date as date, duration,
              transcript_url, summary, participants, created_at, updated_at,
              source, processing_status, organizer_name, organizer_email,
              user_notes,
              (raw_transcript IS NOT NULL OR transcript_url IS NOT NULL OR EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = meetings.id)) as has_transcript,
              (recording_path IS NOT NULL) as has_recording
            FROM meetings
            WHERE source = ${sourceFilter}
            ORDER BY meeting_date DESC
            LIMIT ${limit} OFFSET ${offset}
          `;
        } else {
          totalRows = await sql`
            SELECT COUNT(*) as cnt FROM meetings
            WHERE source = ${sourceFilter}
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(participants) AS p
              WHERE LOWER(p->>'email') = ${userEmail}
                 OR LOWER(p->>'name') = ${userName}
                 OR LOWER(p->>'displayName') = ${userName}
            )
          `;
          meetings = await sql`
            SELECT
              id, fireflies_id, title, meeting_date as date, duration,
              transcript_url, summary, participants, created_at, updated_at,
              source, processing_status, organizer_name, organizer_email,
              user_notes,
              (raw_transcript IS NOT NULL OR transcript_url IS NOT NULL OR EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = meetings.id)) as has_transcript,
              (recording_path IS NOT NULL) as has_recording
            FROM meetings
            WHERE source = ${sourceFilter}
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(participants) AS p
              WHERE LOWER(p->>'email') = ${userEmail}
                 OR LOWER(p->>'name') = ${userName}
                 OR LOWER(p->>'displayName') = ${userName}
            )
            ORDER BY meeting_date DESC
            LIMIT ${limit} OFFSET ${offset}
          `;
        }
      } else {
        if (isHein) {
          totalRows = await sql`SELECT COUNT(*) as cnt FROM meetings`;
          meetings = await sql`
            SELECT
              id, fireflies_id, title, meeting_date as date, duration,
              transcript_url, summary, participants, created_at, updated_at,
              source, processing_status, organizer_name, organizer_email,
              user_notes,
              (raw_transcript IS NOT NULL OR transcript_url IS NOT NULL OR EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = meetings.id)) as has_transcript,
              (recording_path IS NOT NULL) as has_recording
            FROM meetings
            ORDER BY meeting_date DESC
            LIMIT ${limit} OFFSET ${offset}
          `;
        } else {
          totalRows = await sql`
            SELECT COUNT(*) as cnt FROM meetings
            WHERE EXISTS (
              SELECT 1 FROM jsonb_array_elements(participants) AS p
              WHERE LOWER(p->>'email') = ${userEmail}
                 OR LOWER(p->>'name') = ${userName}
                 OR LOWER(p->>'displayName') = ${userName}
            )
          `;
          meetings = await sql`
            SELECT
              id, fireflies_id, title, meeting_date as date, duration,
              transcript_url, summary, participants, created_at, updated_at,
              source, processing_status, organizer_name, organizer_email,
              user_notes,
              (raw_transcript IS NOT NULL OR transcript_url IS NOT NULL OR EXISTS (SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = meetings.id)) as has_transcript,
              (recording_path IS NOT NULL) as has_recording
            FROM meetings
            WHERE EXISTS (
              SELECT 1 FROM jsonb_array_elements(participants) AS p
              WHERE LOWER(p->>'email') = ${userEmail}
                 OR LOWER(p->>'name') = ${userName}
                 OR LOWER(p->>'displayName') = ${userName}
            )
            ORDER BY meeting_date DESC
            LIMIT ${limit} OFFSET ${offset}
          `;
        }
      }

      const total = Number(totalRows[0]?.cnt ?? 0);

      // Lightweight stats breakdown (one query, no participant filter — admin sees global counts)
      const statsRows = isHein
        ? await sql`
            SELECT
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE source = 'teams') as teams,
              COUNT(*) FILTER (WHERE source = 'fireflies') as fireflies,
              COUNT(*) FILTER (WHERE raw_transcript IS NOT NULL OR transcript_url IS NOT NULL) as with_transcripts,
              COUNT(*) FILTER (WHERE recording_path IS NOT NULL) as with_recordings
            FROM meetings
          `
        : await sql`
            SELECT
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE source = 'teams') as teams,
              COUNT(*) FILTER (WHERE source = 'fireflies') as fireflies,
              COUNT(*) FILTER (WHERE raw_transcript IS NOT NULL OR transcript_url IS NOT NULL) as with_transcripts,
              COUNT(*) FILTER (WHERE recording_path IS NOT NULL) as with_recordings
            FROM meetings
            WHERE EXISTS (
              SELECT 1 FROM jsonb_array_elements(participants) AS p
              WHERE LOWER(p->>'email') = ${userEmail}
                 OR LOWER(p->>'name') = ${userName}
                 OR LOWER(p->>'displayName') = ${userName}
            )
          `;

      const statsRow = statsRows[0];

      return res.status(200).json({
        meetings,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        stats: {
          total: Number(statsRow?.total ?? 0),
          teams: Number(statsRow?.teams ?? 0),
          fireflies: Number(statsRow?.fireflies ?? 0),
          withTranscripts: Number(statsRow?.with_transcripts ?? 0),
          withRecordings: Number(statsRow?.with_recordings ?? 0),
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Error fetching meetings:', { error: errorMessage, userEmail });
      return res.status(500).json({ error: errorMessage });
    }
  }

  if (req.method === 'POST' && req.query.action === 'sync') {
    try {
      const apiKey = process.env.FIREFLIES_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'FIREFLIES_API_KEY not configured' });
      }

      const count = await syncFirefliesToNeon(apiKey, sql);

      return res.status(200).json({
        success: true,
        synced: count,
        message: `Synced ${count} meetings from Fireflies`
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Error syncing from Fireflies:', { error: errorMessage });
      return res.status(500).json({ error: errorMessage });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(handler);
