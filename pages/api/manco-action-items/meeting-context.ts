import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { resolveActionItemAccess } from '@/lib/actionItems/meetingAccess';
import { meetingForCaller, type MeetingContentRow } from '@/lib/actionItems/meetingFetch';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

interface TranscriptCue {
  timestamp: string;
  speaker: string;
  text: string;
}

interface MeetingContextResponse {
  meeting: {
    id: number;
    /** Nullable in the table; the UI renders this directly, so it gets a placeholder. */
    title: string;
    /** Nullable in the table — a meeting with no recorded date is real, not an error. */
    meeting_date: string | null;
  } | null;
  excerpts: TranscriptCue[];
  summary: {
    overview: string;
    decisions: string[];
    action_items: string[];
  } | null;
}

function extractMeetingKeywords(actionItem: string): string[] {
  const words = actionItem
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  return words;
}

function parseWebVTT(transcript: string, keywords: string[]): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const lines = transcript.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();

    // Check if this looks like a timestamp line
    if (line.includes('-->')) {
      const timestamp = line.split('-->')[0]!.trim();

      // Next line should have the speaker tag
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]!.trim();
        const speakerMatch = nextLine.match(/<v\s+([^>]+)>/);
        let speaker = '';
        let text = '';

        if (speakerMatch) {
          speaker = speakerMatch[1] ?? '';
          text = nextLine.replace(/<v\s+[^>]+>\s*/, '').replace(/<\/v>\s*/, '');
        } else {
          text = nextLine;
        }

        // Check if text contains any of the keywords
        const lowerText = text.toLowerCase();
        const hasKeyword = keywords.some((kw) => lowerText.includes(kw));

        if (hasKeyword && text.trim()) {
          cues.push({
            timestamp,
            speaker,
            text,
          });
        }
      }
    }

    i += 1;
  }

  // Return top 5 most relevant cues
  return cues.slice(0, 5);
}

async function handler(req: NextApiRequest, res: NextApiResponse<MeetingContextResponse | unknown>) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const resolved = resolveActionItemAccess((req as AuthenticatedNextApiRequest).user);
  if ('error' in resolved) return apiResponse.forbidden(res, resolved.error);
  const access = resolved.access;

  try {
    const { item_id } = req.query;

    if (!item_id || typeof item_id !== 'string') {
      return apiResponse.badRequest(res, 'item_id is required');
    }

    // Fetch the manco action item
    const itemResult = await sql`
      SELECT id, action_item, responsible_person
      FROM manco_action_items
      WHERE id = ${item_id}
    `;

    if (itemResult.length === 0) {
      return apiResponse.notFound(res, 'Item not found');
    }

    const item = itemResult[0] as {
      id: string;
      action_item: string;
      responsible_person?: string;
    };

    // Look up linked meetings from junction table (fallback to source_meeting_id)
    const linkedMeetings = await sql`
      SELECT meeting_id FROM manco_action_item_meetings
      WHERE manco_action_item_id = ${item_id}::uuid
      ORDER BY linked_at ASC
      LIMIT 1
    `;

    let meetingId: number | null = null;
    if (linkedMeetings.length > 0) {
      meetingId = Number(linkedMeetings[0]!.meeting_id);
    } else {
      const legacy = await sql`
        SELECT source_meeting_id FROM manco_action_items
        WHERE id = ${item_id} AND source_meeting_id IS NOT NULL
      `;
      if (legacy.length > 0 && legacy[0]!.source_meeting_id) {
        meetingId = Number(legacy[0]!.source_meeting_id);
      }
    }

    if (!meetingId) {
      const emptyResponse: MeetingContextResponse = {
        meeting: null,
        excerpts: [],
        summary: null,
      };
      return apiResponse.success(res, emptyResponse);
    }

    // Fetch the meeting — ONLY if the caller sat in it.
    //
    // This route returns verbatim transcript excerpts and the meeting summary's overview,
    // decisions and action items. Without this predicate every authenticated user could
    // read them: the item ids are listable from /api/manco-action-items, which is
    // withAuth with no scoping, and the four meetings reachable this way are two Velocity
    // Manco strategy sessions (44k and 91k characters, 10 participants each) and a
    // three-person weekly one-on-one.
    //
    // A non-attendee gets the same empty shape as an item with no linked meeting, rather
    // than a 403. The route already has that shape and the UI already renders it, and it
    // does not confirm to a non-attendee that a meeting exists at all.
    const gated = meetingForCaller(meetingId, access);
    const meetingResult = (await pool.query(gated.text, gated.params)).rows;

    if (meetingResult.length === 0) {
      const emptyResponse: MeetingContextResponse = {
        meeting: null,
        excerpts: [],
        summary: null,
      };
      return apiResponse.success(res, emptyResponse);
    }

    // The shared row type, not a local cast: raw_transcript and summary are both
    // nullable columns and the previous inline cast declared them non-null, which is
    // exactly the shape of claim that turns a null into a runtime crash later.
    const meeting = meetingResult[0] as MeetingContentRow;

    // Extract keywords from action item
    const keywords = extractMeetingKeywords(item.action_item);

    // Parse transcript to find relevant excerpts
    const excerpts = parseWebVTT(meeting.raw_transcript || '', keywords);

    // Build response
    const response: MeetingContextResponse = {
      meeting: {
        id: meeting.id,
        // Both columns are nullable and the previous inline cast declared them
        // otherwise, so this substitution had no code behind it until the shared row
        // type made the nulls visible.
        title: meeting.title ?? '(untitled)',
        meeting_date: meeting.meeting_date,
      },
      excerpts,
      summary: meeting.summary
        ? {
            overview: meeting.summary.overview || '',
            decisions: Array.isArray(meeting.summary.decisions) ? meeting.summary.decisions : [],
            action_items: Array.isArray(meeting.summary.action_items) ? meeting.summary.action_items : [],
          }
        : null,
    };

    // This response now varies per caller — excerpts for an attendee, the empty shape
    // for everyone else — so it must never be held in a shared cache. It was
    // caller-independent before the gate, which is why no header was needed until now.
    res.setHeader('Cache-Control', 'private, no-store');
    return apiResponse.success(res, response);
  } catch (error: unknown) {
    log.error('Error fetching meeting context', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
