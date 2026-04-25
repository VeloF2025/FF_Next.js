/**
 * POST /api/staff/receipts-review — finance/HR transitions a receipt's status.
 *
 * Body: { id: UUID, action: 'approve' | 'reject' | 'reconcile', note?: string }
 *
 * Allowed transitions are enforced in transitionReceiptStatus (queries.ts):
 *   submitted  → approved | rejected
 *   approved   → reconciled | rejected
 *   rejected   → approved (paperwork fixed)
 *   reconciled → approved (rare undo)
 *
 * Reject requires a non-empty note (>=5 chars) — staff need an
 * explanation. Approve / reconcile note is optional.
 *
 * RBAC: receipts.review, edit.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withPermission } from '@/lib/auth/middleware';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { findReceiptById } from '@/modules/receipts/queries';
import {
  transitionReceiptStatus,
  type ReviewAction,
} from '@/modules/receipts/queries-review';

const ACTIONS: ReviewAction[] = ['approve', 'reject', 'reconcile'];

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isAction(value: unknown): value is ReviewAction {
  return typeof value === 'string' && (ACTIONS as string[]).includes(value);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const reviewerId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!reviewerId) {
    return apiResponse.unauthorized(res);
  }

  const body = (req.body ?? {}) as { id?: unknown; action?: unknown; note?: unknown };

  if (!isUuid(body.id)) {
    return apiResponse.badRequest(res, 'id must be a UUID');
  }
  if (!isAction(body.action)) {
    return apiResponse.badRequest(res, "action must be 'approve' | 'reject' | 'reconcile'");
  }

  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (body.action === 'reject' && note.length < 5) {
    return apiResponse.badRequest(res, 'A reject note (>=5 chars) is required so the staff member knows why');
  }
  if (note.length > 500) {
    return apiResponse.badRequest(res, 'Note must be 500 characters or fewer');
  }

  try {
    const updated = await transitionReceiptStatus({
      id: body.id,
      action: body.action,
      reviewerId,
      note: note.length > 0 ? note : null,
    });

    if (!updated) {
      const existing = await findReceiptById(body.id, null);
      if (!existing) {
        return apiResponse.notFound(res, 'Receipt', body.id);
      }
      return apiResponse.conflict(
        res,
        `Cannot ${body.action} a receipt in status '${existing.status}'`
      );
    }

    log.info('[staff/receipts-review] transitioned', {
      reviewerId,
      receiptId: updated.id,
      action: body.action,
      newStatus: updated.status,
    });

    return apiResponse.success(res, {
      id: updated.id,
      status: updated.status,
      reviewedBy: updated.reviewed_by,
      reviewedAt: updated.reviewed_at,
      reviewNote: updated.review_note,
    });
  } catch (err) {
    log.error('[staff/receipts-review] failed', {
      err,
      reviewerId,
      receiptId: body.id,
      action: body.action,
    });
    return apiResponse.internalError(res, 'Failed to update receipt status');
  }
}

export default withAuth(withPermission('receipts.review', 'edit')(handler));
