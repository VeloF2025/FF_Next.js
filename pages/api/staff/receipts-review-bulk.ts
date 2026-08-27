/**
 * POST /api/staff/receipts-review-bulk — approve/reject/reconcile a
 * set of receipts in one call.
 *
 * Body: { ids: UUID[] (1-100), action: 'approve' | 'reject' | 'reconcile', note?: string }
 *
 * Same transition rules and note requirements as the single-item
 * /api/staff/receipts-review — see queries-review.ts ALLOWED_TRANSITIONS.
 * Ids not eligible for the requested transition (wrong status, already
 * changed by someone else) are silently excluded from the update and
 * reported back in `skippedIds` rather than failing the whole batch.
 *
 * RBAC: receipts.review, edit.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withPermission } from '@/lib/auth/middleware';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { sendReceiptApprovedEmail } from '@/modules/receipts/email';
import { transitionReceiptStatusBulk } from '@/modules/receipts/queries-review-bulk';
import type { ReviewAction } from '@/modules/receipts/queries-review';

const ACTIONS: ReviewAction[] = ['approve', 'reject', 'reconcile'];
const MAX_IDS = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAction(value: unknown): value is ReviewAction {
  return typeof value === 'string' && (ACTIONS as string[]).includes(value);
}

function parseIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDS) return null;
  if (!value.every((v) => typeof v === 'string' && UUID_RE.test(v))) return null;
  return value;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const reviewerId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!reviewerId) {
    return apiResponse.unauthorized(res);
  }

  const body = (req.body ?? {}) as { ids?: unknown; action?: unknown; note?: unknown };

  const ids = parseIds(body.ids);
  if (!ids) {
    return apiResponse.badRequest(res, `ids must be an array of 1-${MAX_IDS} UUIDs`);
  }
  if (!isAction(body.action)) {
    return apiResponse.badRequest(res, "action must be 'approve' | 'reject' | 'reconcile'");
  }

  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (body.action === 'reject' && note.length < 5) {
    return apiResponse.badRequest(res, 'A reject note (>=5 chars) is required so staff know why');
  }
  if (note.length > 500) {
    return apiResponse.badRequest(res, 'Note must be 500 characters or fewer');
  }

  try {
    const { updated, skippedIds } = await transitionReceiptStatusBulk({
      ids,
      action: body.action,
      reviewerId,
      note: note.length > 0 ? note : null,
    });

    log.info('[staff/receipts-review/bulk] transitioned', {
      reviewerId,
      action: body.action,
      updatedCount: updated.length,
      skippedCount: skippedIds.length,
    });

    if (body.action === 'approve') {
      // Best-effort accounting notification per receipt. Sequenced (not
      // Promise.all) so a 100-item batch doesn't open 100 concurrent VF
      // Storage downloads + SMTP sessions at once; not awaited by the
      // response either way. SMTP failures must not fail the API.
      void (async () => {
        for (const receipt of updated) {
          await sendReceiptApprovedEmail(receipt);
        }
      })();
    }

    return apiResponse.success(res, {
      updatedIds: updated.map((r) => r.id),
      skippedIds,
    });
  } catch (err) {
    log.error('[staff/receipts-review/bulk] failed', {
      err,
      reviewerId,
      action: body.action,
      count: ids.length,
    });
    return apiResponse.internalError(res, 'Failed to update receipts');
  }
}

export default withAuth(withPermission('receipts.review', 'edit')(handler));
