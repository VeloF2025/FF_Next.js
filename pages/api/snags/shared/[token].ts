/**
 * Shared Snag Ticket API (public — no auth required)
 *
 * GET  /api/snags/shared/[token] — Get ticket data for the public resolve page
 * POST /api/snags/shared/[token] — Perform an action (start_work, submit_for_qa, complete_step)
 *
 * Actions are gated by ticket status:
 *   - start_work:     only when status = 'assigned'
 *   - submit_for_qa:  only when status = 'in_progress'
 *   - complete_step:  only when status = 'in_progress'
 *
 * When status is not assigned/in_progress, the page is read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

/** Statuses where the subcontractor can interact */
const INTERACTIVE_STATUSES = new Set(['assigned', 'in_progress']);

async function resolveToken(token: string) {
  const rows = await sql`
    SELECT st.ticket_id, st.is_active, st.created_at as shared_at,
           mt.id, mt.ticket_uid, mt.status, mt.title, mt.description, mt.priority,
           mt.type, mt.source,
           (u.first_name || ' ' || u.last_name) AS assigned_to_name,
           p.project_name
    FROM snag_share_tokens st
    JOIN maintenance_tickets mt ON mt.id = st.ticket_id
    LEFT JOIN users u ON u.id = mt.assigned_to
    LEFT JOIN snags s ON s.noc_ticket_id = mt.id
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE st.token = ${token}
    LIMIT 1
  ` as Array<Record<string, unknown>>;

  if (rows.length === 0) return null;
  return rows[0]!;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return apiResponse.error(res, 400 as never, 'Token is required');
  }

  const ticketData = await resolveToken(token);
  if (!ticketData || !ticketData.is_active) {
    return apiResponse.error(res, 404 as never, 'Invalid or expired share link');
  }

  const ticketId = ticketData.ticket_id as string;
  const status = ticketData.status as string;
  const canInteract = INTERACTIVE_STATUSES.has(status);

  if (req.method === 'GET') {
    // Fetch verification steps
    const steps = await sql`
      SELECT id, step_number, step_name, step_description, is_complete, completed_at,
             photo_required, photo_url, photo_verified, notes
      FROM maintenance_verification_steps
      WHERE ticket_id = ${ticketId}
      ORDER BY step_number ASC
    ` as Array<Record<string, unknown>>;

    // Fetch before photo (from snag_photos via linked snag)
    const beforePhotos = await sql`
      SELECT sp.photo_url, sp.thumbnail_url, sp.phase
      FROM snag_photos sp
      JOIN snags s ON s.id = sp.snag_id
      WHERE s.noc_ticket_id = ${ticketId}
        AND sp.phase = 'before'
      ORDER BY sp.created_at ASC
      LIMIT 3
    ` as Array<Record<string, unknown>>;

    // Fetch ticket attachments (after photos uploaded by subcontractor)
    const attachments = await sql`
      SELECT id, filename, storage_url, file_type, uploaded_at
      FROM maintenance_attachments
      WHERE ticket_id = ${ticketId}
      ORDER BY uploaded_at ASC
    ` as Array<Record<string, unknown>>;

    return apiResponse.success(res, {
      ticket: {
        id: ticketId,
        ticket_uid: ticketData.ticket_uid,
        status,
        title: ticketData.title,
        description: ticketData.description,
        priority: ticketData.priority,
        assigned_to_name: ticketData.assigned_to_name,
        project_name: ticketData.project_name,
      },
      canInteract,
      canStartWork: status === 'assigned',
      canSubmit: status === 'in_progress',
      steps,
      beforePhotos,
      attachments,
    });
  }

  if (req.method === 'POST') {
    const { action, stepId, notes } = req.body as {
      action: 'start_work' | 'submit_for_qa' | 'complete_step';
      stepId?: string;
      notes?: string;
    };

    if (!action) {
      return apiResponse.error(res, 400 as never, 'action is required');
    }

    try {
      if (action === 'start_work') {
        if (status !== 'assigned') {
          return apiResponse.error(res, 400 as never, 'Ticket must be in Assigned status to start work');
        }
        await sql`UPDATE maintenance_tickets SET status = 'in_progress', updated_at = NOW() WHERE id = ${ticketId}`;
        // Also update linked snag
        await sql`UPDATE snags SET status = 'in_progress', updated_at = NOW() WHERE noc_ticket_id = ${ticketId}`;
        log.info('Shared ticket: start work', { ticketId, token: token.substring(0, 8) });
        return apiResponse.success(res, { newStatus: 'in_progress' });
      }

      if (action === 'submit_for_qa') {
        if (status !== 'in_progress') {
          return apiResponse.error(res, 400 as never, 'Ticket must be In Progress to submit for QA');
        }
        await sql`UPDATE maintenance_tickets SET status = 'pending_qa', updated_at = NOW() WHERE id = ${ticketId}`;
        await sql`UPDATE snags SET status = 'pending_qa', updated_at = NOW(), fixed_at = NOW() WHERE noc_ticket_id = ${ticketId}`;
        log.info('Shared ticket: submitted for QA', { ticketId, token: token.substring(0, 8) });
        return apiResponse.success(res, { newStatus: 'pending_qa' });
      }

      if (action === 'complete_step') {
        if (status !== 'in_progress') {
          return apiResponse.error(res, 400 as never, 'Ticket must be In Progress to complete steps');
        }
        if (!stepId) {
          return apiResponse.error(res, 400 as never, 'stepId is required');
        }
        await sql`
          UPDATE maintenance_verification_steps
          SET is_complete = true, completed_at = NOW(), notes = COALESCE(${notes ?? null}, notes)
          WHERE id = ${stepId} AND ticket_id = ${ticketId}
        `;
        log.info('Shared ticket: step completed', { ticketId, stepId, token: token.substring(0, 8) });
        return apiResponse.success(res, { completed: true });
      }

      return apiResponse.error(res, 400 as never, 'Invalid action');
    } catch (error) {
      log.error('Shared ticket action error', { error, ticketId, action });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET', 'POST']);
}

// No withAuth — this is a public endpoint
export default handler;
