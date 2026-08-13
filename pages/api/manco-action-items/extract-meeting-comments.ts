import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { resolveActionItemAccess } from '@/lib/actionItems/meetingAccess';
import { meetingForCaller } from '@/lib/actionItems/meetingFetch';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

interface TranscriptCue {
  timestamp: string;
  speaker: string;
  text: string;
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

function parseWebVTT(transcript: string, keywords: string[]): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const lines = transcript.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();

    if (line.includes('-->')) {
      const timestamp = line.split('-->')[0]!.trim();

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

        const lowerText = text.toLowerCase();
        const hasKeyword = keywords.some((kw) => lowerText.includes(kw));

        if (hasKeyword && text.trim()) {
          cues.push({ timestamp, speaker, text });
        }
      }
    }

    i += 1;
  }

  return cues.slice(0, 5);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const resolved = resolveActionItemAccess((req as AuthenticatedNextApiRequest).user);
  if ('error' in resolved) return apiResponse.forbidden(res, resolved.error);
  const access = resolved.access;

  try {
    const { manco_action_item_id, meeting_id } = req.body;

    if (!manco_action_item_id || !meeting_id) {
      return apiResponse.badRequest(res, 'manco_action_item_id and meeting_id are required');
    }

    const meetingIdNum = Number(meeting_id);
    if (!Number.isFinite(meetingIdNum) || meetingIdNum <= 0) {
      return apiResponse.badRequest(res, 'meeting_id must be a positive number');
    }

    // Fetch the action item text
    const itemRows = await sql`
      SELECT id, action_item FROM manco_action_items
      WHERE id = ${String(manco_action_item_id)}::uuid
    `;
    if (itemRows.length === 0) {
      return apiResponse.notFound(res, 'Manco action item', manco_action_item_id);
    }
    const actionItemText = String(itemRows[0]!.action_item);

    // Fetch the meeting transcript — ONLY if the caller sat in the meeting.
    //
    // `meeting_id` arrives in the REQUEST BODY and was never checked against the item's
    // linked meetings, so this accepted any of the 4,000+ meetings in the table. Combined
    // with PATCH /api/manco-action-items/[id] — which accepts `action_item` and has no
    // ownership check — the keywords are caller-controlled too, and the extracted lines
    // are INSERTED as comments that /api/manco-action-items/comments then serves to
    // anyone. That made this a targeted transcript-extraction primitive over every
    // meeting, writing what it took into a permanent readable store.
    const gated = meetingForCaller(meetingIdNum, access);
    const meetingRows = (await pool.query(gated.text, gated.params)).rows;
    if (meetingRows.length === 0) {
      // 403, not 404: this is a write path, so the caller needs to know it was refused
      // rather than silently doing nothing. It does not distinguish "no such meeting"
      // from "not yours".
      return apiResponse.forbidden(res, 'Meeting not found or you are not a participant');
    }
    const meeting = meetingRows[0] as {
      id: number;
      title: string;
      raw_transcript: string | null;
      summary: { overview?: string; decisions?: string[]; action_items?: string[] } | null;
    };

    if (!meeting.raw_transcript) {
      return apiResponse.success(res, { comments_inserted: 0, reason: 'No transcript available' });
    }

    // Check for existing auto-extracted comments to avoid duplicates
    const prefix = `[From meeting: ${meeting.title}]`;
    const existing = await sql`
      SELECT COUNT(*)::int as cnt FROM manco_action_item_comments
      WHERE manco_action_item_id = ${String(manco_action_item_id)}::uuid
        AND content LIKE ${prefix + '%'}
    `;
    if (Number(existing[0]!.cnt) > 0) {
      return apiResponse.success(res, { comments_inserted: 0, reason: 'Comments already extracted' });
    }

    // Extract relevant excerpts
    const keywords = extractKeywords(actionItemText);
    const cues = parseWebVTT(meeting.raw_transcript, keywords);

    if (cues.length === 0) {
      return apiResponse.success(res, { comments_inserted: 0, reason: 'No relevant excerpts found' });
    }

    // Insert each excerpt as a comment
    let inserted = 0;
    for (const cue of cues) {
      const authorName = cue.speaker || 'Meeting Transcript';
      const content = `${prefix}\n[${cue.timestamp}]\n${cue.text}`;

      await sql`
        INSERT INTO manco_action_item_comments (manco_action_item_id, author_name, content)
        VALUES (${String(manco_action_item_id)}::uuid, ${authorName}, ${content})
      `;
      inserted++;
    }

    log.info('Extracted meeting comments', {
      itemId: manco_action_item_id,
      meetingId: meetingIdNum,
      meetingTitle: meeting.title,
      commentsInserted: inserted,
    });

    return apiResponse.success(res, { comments_inserted: inserted });
  } catch (error: unknown) {
    log.error('Error extracting meeting comments', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
