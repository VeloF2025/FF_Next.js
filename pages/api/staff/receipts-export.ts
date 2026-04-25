/**
 * GET /api/staff/receipts-export — CSV of the review queue for accounting.
 *
 * Same query params as /api/staff/receipts (filters), but no pagination —
 * returns up to 5000 rows so a month/category/staff CSV is one shot.
 * Streams a UTF-8 CSV with a BOM so Excel opens R-amounts in Rand format.
 *
 * RBAC: receipts.review, view.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withPermission } from '@/lib/auth/middleware';
import type { ReceiptStatus } from '@/modules/receipts/queries';
import { listReceiptsForReview } from '@/modules/receipts/queries-review';
import {
  isValidReceiptCategory,
  RECEIPT_CATEGORY_LABELS,
} from '@/modules/receipts/categories';

const RECEIPT_STATUSES: ReceiptStatus[] = ['submitted', 'approved', 'rejected', 'reconciled'];
const EXPORT_LIMIT = 5000;

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

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function centsToRand(value: string | null): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return (n / 100).toFixed(2);
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

  try {
    const items = await listReceiptsForReview({
      staffId,
      projectId,
      category,
      status,
      month,
      limit: EXPORT_LIMIT,
      offset: 0,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `receipts-${stamp}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');

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
