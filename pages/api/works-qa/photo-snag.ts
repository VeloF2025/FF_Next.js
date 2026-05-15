import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  createPhotoSnag,
  type SnagSeverity,
} from '@/modules/works-qa/services/photoSnagService';
import { logTicketActivity } from '@/modules/noc/services/ticketService';

interface Body {
  pole_qa_photo_id?: string;
  slot_key?: string;
  comment?: string;
  severity?: SnagSeverity;
  assigned_to_user_id?: string;
  /**
   * If true and an open snag already exists on this slot, append the comment
   * to the linked NOC ticket as a 'note' activity (instead of returning 409).
   * Mirrors Hein's UX rule: block duplicates, offer amend.
   */
  amend?: boolean;
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set(['minor', 'major', 'critical']);

async function resolveSiteManagerUserId(projectId: string): Promise<string | null> {
  // v_project_team.person_id is staff.id (cast to text). snags.assigned_to
  // references users(id). Bridge via staff.user_id (production schema).
  const { rows } = await pool.query<{ user_id: string | null }>(
    `SELECT s.user_id
       FROM v_project_team vpt
       JOIN staff s ON s.id::text = vpt.person_id
      WHERE vpt.project_id = $1
        AND vpt.person_type = 'staff'
        AND vpt.is_active = true
        AND LOWER(vpt.role) = 'site manager'
      LIMIT 1`,
    [projectId]
  );
  return rows[0]?.user_id ?? null;
}

async function getPoleProjectId(poleQaPhotoId: string): Promise<string | null> {
  const { rows } = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM pole_qa_photos WHERE id = $1 LIMIT 1`,
    [poleQaPhotoId]
  );
  return rows[0]?.project_id ?? null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  const body = (req.body ?? {}) as Body;
  const { pole_qa_photo_id, slot_key, comment, severity, assigned_to_user_id, amend } = body;

  if (!pole_qa_photo_id || !slot_key) {
    return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'pole_qa_photo_id and slot_key are required');
  }
  if (!comment || !comment.trim()) {
    return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'comment is required');
  }
  if (comment.length > 2000) {
    return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'comment too long (max 2000 chars)');
  }
  if (severity && !VALID_SEVERITIES.has(severity)) {
    return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, `invalid severity: ${severity}`);
  }

  const user = (req as AuthenticatedNextApiRequest).user;

  // Auto-assign to project site manager when caller didn't pass an assignee.
  let assigneeUserId = assigned_to_user_id?.trim() || undefined;
  if (!assigneeUserId) {
    const projectId = await getPoleProjectId(pole_qa_photo_id);
    if (projectId) {
      const resolved = await resolveSiteManagerUserId(projectId);
      if (resolved) assigneeUserId = resolved;
    }
  }

  try {
    const result = await createPhotoSnag({
      poleQaPhotoId: pole_qa_photo_id,
      slotKey: slot_key,
      comment: comment.trim(),
      severity,
      assignedToUserId: assigneeUserId,
      createdBy: user.id,
    });

    if (result.status === 'duplicate') {
      if (!amend) {
        return apiResponse.error(
          res,
          ErrorCode.CONFLICT,
          'An open snag already exists for this slot',
          { existing_snag_id: result.snag.id, existing_ticket_id: result.snag.noc_ticket_id, slot_approvals: result.slotApprovals }
        );
      }
      // Amend mode: append the new comment to the linked ticket's activity log.
      // If the snag has no linked ticket (data-corrupted edge case), surface
      // that via `note_appended: false` rather than succeeding silently — the
      // UI then knows it needs to fall back to a different code path.
      let noteAppended = false;
      if (result.snag.noc_ticket_id) {
        await logTicketActivity({
          ticketId: result.snag.noc_ticket_id,
          activityType: 'note',
          description: `[Amend snag ${result.snag.id}] ${comment.trim()}`,
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
        });
        noteAppended = true;
      } else {
        log.warn('works-qa/photo-snag amend without ticket', { snag_id: result.snag.id });
      }
      return apiResponse.success(res, {
        status: 'amended',
        snag: result.snag,
        slot_approvals: result.slotApprovals,
        note_appended: noteAppended,
      });
    }

    return apiResponse.success(res, {
      status: 'created',
      snag: result.snag,
      ticket: result.ticket,
      slot_approvals: result.slotApprovals,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('works-qa/photo-snag', { error: msg, pole_qa_photo_id, slot_key });
    if (msg.includes('Unknown slot key')) return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, msg);
    if (msg.includes('not found')) return apiResponse.notFound(res, 'Pole', pole_qa_photo_id);
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.snags.create', 'create')(handler));
