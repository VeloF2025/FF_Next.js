/**
 * GET /api/meetings/[id]/export?type=summary|transcript|action-items
 * Export meeting data as markdown/text file download
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
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

  try {
    const [meeting] = await sql`
      SELECT id, title, meeting_date, summary, raw_transcript, user_notes
      FROM meetings WHERE id = ${meetingId}
    `;

    if (!meeting) {
      return apiResponse.notFound(res, 'Meeting not found');
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
        const [tx] = await sql`
          SELECT content FROM meeting_transcripts WHERE meeting_id = ${meetingId} LIMIT 1
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
