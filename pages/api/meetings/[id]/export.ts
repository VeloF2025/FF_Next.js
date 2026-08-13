/**
 * GET /api/meetings/[id]/export?type=summary|transcript|action-items
 * Export meeting data as markdown/text file download
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { isOwner } from '@/lib/auth/owner';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const meetingId = req.query.id as string;
  const exportType = req.query.type as string;

  if (!['summary', 'transcript', 'action-items'].includes(exportType)) {
    return apiResponse.badRequest(res, 'type must be summary, transcript, or action-items');
  }

  // This route serves the same three payloads as transcript.ts, notes.ts and
  // recording.ts — all of which gate on participation — but had no check beyond withAuth.
  // `?type=transcript` therefore walked straight around the gate its own sibling enforces,
  // and `?type=action-items` returned the meeting content the action-item routes withhold.
  const user = (req as AuthenticatedNextApiRequest).user;
  const userEmail = (user?.email ?? '').trim().toLowerCase();
  const owner = isOwner(user);

  if (!owner && !userEmail) {
    return apiResponse.forbidden(res, 'User email is required for meeting export');
  }

  try {
    // Owner reads unconditionally; everyone else must appear in participants. Matches the
    // shape used by transcript.ts.
    const rows = owner
      ? await sql`
          SELECT id, title, meeting_date, summary, raw_transcript, user_notes
          FROM meetings WHERE id = ${meetingId}
        `
      : await sql`
          SELECT id, title, meeting_date, summary, raw_transcript, user_notes
          FROM meetings
          WHERE id = ${meetingId}
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(participants, '[]'::jsonb)) AS p
              WHERE LOWER(p->>'email') = ${userEmail}
            )
        `;
    const [meeting] = rows;

    if (!meeting) {
      // 403, not 404 — a 404 here would still confirm which meeting ids exist to anyone
      // enumerating them. Mirrors transcript.ts.
      return apiResponse.forbidden(res, 'Meeting not found or you are not a participant');
    }

    const date = meeting.meeting_date
      ? new Date(meeting.meeting_date).toISOString().split('T')[0]
      : 'unknown-date';
    const safeTitle = (meeting.title || 'meeting').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-');

    if (exportType === 'summary') {
      const summary = meeting.summary;
      const lines: string[] = [
        `# ${meeting.title}`,
        `**Date:** ${date}`,
        '',
      ];

      if (summary?.overview) {
        lines.push('## Summary', summary.overview, '');
      }

      if (summary?.decisions?.length) {
        lines.push('## Decisions');
        summary.decisions.forEach((d: string) => lines.push(`- ${d}`));
        lines.push('');
      }

      if (summary?.keywords?.length) {
        lines.push('## Keywords');
        lines.push(summary.keywords.join(', '), '');
      }

      if (summary?.outline?.length) {
        lines.push('## Outline');
        summary.outline.forEach((item: string, i: number) => lines.push(`${i + 1}. ${item}`));
        lines.push('');
      }

      if (summary?.action_items?.length) {
        lines.push('## Action Items');
        const items = Array.isArray(summary.action_items) ? summary.action_items : [summary.action_items];
        items.forEach((item: string) => lines.push(`- ${item}`));
        lines.push('');
      }

      if (meeting.user_notes) {
        lines.push('## Notes', meeting.user_notes, '');
      }

      const content = lines.join('\n');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}-summary-${date}.md"`);
      return res.status(200).send(content);
    }

    if (exportType === 'transcript') {
      let transcript = meeting.raw_transcript;

      if (!transcript) {
        // A meeting can hold multiple meeting_transcripts rows (vtt + whisper-af/-en),
        // so order deterministically and take the most recent — mirrors the resolver in
        // pages/api/meetings/[id]/transcript.ts (an unordered LIMIT 1 returned an arbitrary
        // format's content).
        const [tx] = await sql`
          SELECT content FROM meeting_transcripts
          WHERE meeting_id = ${meetingId}
          ORDER BY created_at DESC
          LIMIT 1
        `;
        transcript = tx?.content;
      }

      if (!transcript) {
        return apiResponse.notFound(res, 'No transcript available');
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}-transcript-${date}.txt"`);
      return res.status(200).send(transcript);
    }

    if (exportType === 'action-items') {
      const items = await sql`
        SELECT description, assignee_name, status, priority, due_date
        FROM action_items
        WHERE meeting_id = ${meetingId}
        ORDER BY status ASC, created_at ASC
      `;

      const lines: string[] = [
        `# Action Items: ${meeting.title}`,
        `**Date:** ${date}`,
        '',
      ];

      if (items.length === 0) {
        lines.push('_No action items extracted._');
      } else {
        items.forEach((item: Record<string, string>) => {
          const checkbox = item.status === 'completed' ? '[x]' : '[ ]';
          const assignee = item.assignee_name ? ` (@${item.assignee_name})` : '';
          const due = item.due_date ? ` due:${item.due_date}` : '';
          lines.push(`- ${checkbox} ${item.description}${assignee}${due}`);
        });
      }

      const content = lines.join('\n');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}-action-items-${date}.md"`);
      return res.status(200).send(content);
    }
  } catch (error) {
    log.error('Export error:', { error: error });
    return apiResponse.internalError(res, new Error('Export failed'));
  }
}

export default withAuth(handler);
