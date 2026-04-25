/**
 * GET /api/staff/receipts — finance/HR review queue list.
 *
 * Query params (all optional):
 *   staffId, projectId   — UUID filters
 *   category             — closed taxonomy
 *   status               — submitted | approved | rejected | reconciled
 *   month                — YYYY-MM (filters receipt_date)
 *   limit                — clamped to [1, 500], default 200
 *   offset               — default 0
 *   summary=1            — also include per-status totals in `summary`
 *
 * Filter parsing lives in src/modules/receipts/reviewFilters.ts so
 * this route + receipts-export.ts can't drift.
 *
 * RBAC: receipts.review, view.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withPermission } from '@/lib/auth/middleware';
import {
  listReceiptsForReview,
  summariseReceiptsForReview,
} from '@/modules/receipts/queries-review';
import { parseReviewFilters } from '@/modules/receipts/reviewFilters';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const parsed = parseReviewFilters(req.query, { defaultLimit: 200, maxLimit: 500 });
  const wantSummary =
    (Array.isArray(req.query.summary) ? req.query.summary[0] : req.query.summary) === '1';

  try {
    const items = await listReceiptsForReview(parsed);

    if (!wantSummary) {
      return apiResponse.success(res, { items });
    }

    const summaryRows = await summariseReceiptsForReview({
      staffId: parsed.staffId,
      projectId: parsed.projectId,
      category: parsed.category,
      status: parsed.status,
      month: parsed.month,
    });
    const summary = {
      submitted: { count: 0, totalCents: 0 },
      approved: { count: 0, totalCents: 0 },
      rejected: { count: 0, totalCents: 0 },
      reconciled: { count: 0, totalCents: 0 },
    };
    for (const row of summaryRows) {
      summary[row.status] = {
        count: Number(row.count),
        totalCents: Number(row.total_cents),
      };
    }

    return apiResponse.success(res, { items, summary });
  } catch (err) {
    log.error('[staff/receipts] list failed', { err });
    return apiResponse.internalError(res, 'Failed to load receipts queue');
  }
}

export default withAuth(withPermission('receipts.review', 'view')(handler));
