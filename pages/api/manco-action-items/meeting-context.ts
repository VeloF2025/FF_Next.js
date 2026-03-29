import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
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
    title: string;
    meeting_date: string;
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
    const line = lines[i].trim();

    // Check if this looks like a timestamp line
    if (line.includes('-->')) {
      const timestamp = line.split('-->')[0].trim();

      // Next line should have the speaker tag
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        const speakerMatch = nextLine.match(/<v\s+([^>]+)>/);
        let speaker = '';
        let text = '';

        if (speakerMatch) {
          speaker = speakerMatch[1];
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

  try {
    const { item_id } = req.query;

    if (!item_id || typeof item_id !== 'string') {
      return apiResponse.badRequest(res, 'item_id is required');
    }

    // Fetch the manco action item
    const itemResult = await sql`
      SELECT id, action_item, source_meeting_id, responsible_person
      FROM manco_action_items
      WHERE id = ${item_id}
    `;

    if (itemResult.length === 0) {
      return apiResponse.notFound(res, 'Item not found');
    }

    const item = itemResult[0] as {
      id: string;
      action_item: string;
      source_meeting_id?: number;
      responsible_person?: string;
    };

    // If no meeting linked, return early
    if (!item.source_meeting_id) {
      const emptyResponse: MeetingContextResponse = {
        meeting: null,
        excerpts: [],
        summary: null,
      };
      return apiResponse.success(res, emptyResponse);
    }

    // Fetch the meeting
    const meetingResult = await sql`
      SELECT id, title, meeting_date, raw_transcript, summary
      FROM meetings
      WHERE id = ${item.source_meeting_id}
    `;

    if (meetingResult.length === 0) {
      const emptyResponse: MeetingContextResponse = {
        meeting: null,
        excerpts: [],
        summary: null,
      };
      return apiResponse.success(res, emptyResponse);
    }

    const meeting = meetingResult[0] as {
      id: number;
      title: string;
      meeting_date: string;
      raw_transcript: string;
      summary: {
        overview?: string;
        decisions?: string[];
        action_items?: string[];
      };
    };

    // Extract keywords from action item
    const keywords = extractMeetingKeywords(item.action_item);

    // Parse transcript to find relevant excerpts
    const excerpts = parseWebVTT(meeting.raw_transcript || '', keywords);

    // Build response
    const response: MeetingContextResponse = {
      meeting: {
        id: meeting.id,
        title: meeting.title,
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

    return apiResponse.success(res, response);
  } catch (error: unknown) {
    log.error('Error fetching meeting context', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
