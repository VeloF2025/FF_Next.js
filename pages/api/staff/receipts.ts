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
 * RBAC: receipts.review, view.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withPermission } from '@/lib/auth/middleware';
import type { ReceiptStatus } from '@/modules/receipts/queries';
import {
  listReceiptsForReview,
  summariseReceiptsForReview,
} from '@/modules/receipts/queries-review';
import { isValidReceiptCategory } from '@/modules/receipts/categories';

const RECEIPT_STATUSES: ReceiptStatus[] = ['submitted', 'approved', 'rejected', 'reconciled'];

function singleParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseUuid(value: string | null): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function parseMonth(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

function parseStatus(value: string | null): ReceiptStatus | null {
  if (!value) return null;
  return (RECEIPT_STATUSES as string[]).includes(value) ? (value as ReceiptStatus) : null;
}

function parseInt32(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const q = req.query;
  const staffId = parseUuid(singleParam(q.staffId));
  const projectId = parseUuid(singleParam(q.projectId));
  const categoryRaw = singleParam(q.category);
  const category = categoryRaw && isValidReceiptCategory(categoryRaw) ? categoryRaw : null;
  const status = parseStatus(singleParam(q.status));
  const month = parseMonth(singleParam(q.month));
  const limit = parseInt32(singleParam(q.limit), 200, 1, 500);
  const offset = parseInt32(singleParam(q.offset), 0, 0, 1_000_000);
  const wantSummary = singleParam(q.summary) === '1';

  try {
    const filters = { staffId, projectId, category, status, month };
    const items = await listReceiptsForReview({ ...filters, limit, offset });

    if (!wantSummary) {
      return apiResponse.success(res, { items });
    }

    const summaryRows = await summariseReceiptsForReview(filters);
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
