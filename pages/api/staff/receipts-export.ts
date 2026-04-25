/**
 * GET /api/staff/receipts-export — CSV of the review queue for accounting.
 *
 * Same query params as /api/staff/receipts, no pagination — returns up
 * to 5000 rows so a month/category/staff CSV is one shot. Streams a
 * UTF-8 CSV with a BOM so Excel opens R-amounts correctly.
 *
 * Filter parsing lives in src/modules/receipts/reviewFilters.ts.
 *
 * RBAC: receipts.review, view.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withPermission } from '@/lib/auth/middleware';
import { listReceiptsForReview } from '@/modules/receipts/queries-review';
import { RECEIPT_CATEGORY_LABELS } from '@/modules/receipts/categories';
import { parseReviewFilters } from '@/modules/receipts/reviewFilters';
import { csvEscape, centsToRand } from '@/modules/receipts/csv';

const EXPORT_LIMIT = 5000;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const parsed = parseReviewFilters(req.query, {
    defaultLimit: EXPORT_LIMIT,
    maxLimit: EXPORT_LIMIT,
  });

  try {
    const items = await listReceiptsForReview({
      staffId: parsed.staffId,
      projectId: parsed.projectId,
      category: parsed.category,
      status: parsed.status,
      month: parsed.month,
      limit: parsed.limit,
      offset: 0,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `receipts-${stamp}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const headers = [
      'Receipt date',
      'Captured at',
      'Staff',
      'Staff email',
      'Vendor',
      'Category',
      'Description',
      'Total (R)',
      'VAT (R)',
      'Currency',
      'Payment method',
      'Project',
      'Vehicle',
      'Status',
      'Reviewed by',
      'Reviewed at',
      'Review note',
      'Receipt ID',
    ];
    const lines: string[] = [];
    lines.push('﻿' + headers.map(csvEscape).join(','));
    for (const r of items) {
      lines.push([
        r.receipt_date,
        r.captured_at,
        r.staff_name ?? '',
        r.staff_email ?? '',
        r.vendor ?? '',
        RECEIPT_CATEGORY_LABELS[r.category] ?? r.category,
        r.description ?? '',
        centsToRand(r.total_cents),
        centsToRand(r.vat_cents),
        r.currency,
        r.payment_method,
        r.project_name ?? '',
        r.vehicle_registration ?? '',
        r.status,
        r.reviewed_by_name ?? '',
        r.reviewed_at ?? '',
        r.review_note ?? '',
        r.id,
      ].map(csvEscape).join(','));
    }

    res.status(200).send(lines.join('\r\n') + '\r\n');
  } catch (err) {
    log.error('[staff/receipts-export] failed', { err });
    if (!res.headersSent) {
      return apiResponse.internalError(res, 'Failed to export receipts');
    }
  }
}

export default withAuth(withPermission('receipts.review', 'view')(handler));
