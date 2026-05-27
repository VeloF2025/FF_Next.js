/**
 * GET /api/my/receipts — list staff's own active receipts.
 *
 * Excludes rejected (those failed finance review and shouldn't reappear
 * in the staff inbox). Latest receipt_date first.
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { listReceiptsForStaff } from '@/modules/receipts/queries';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export interface ReceiptListItem {
  id: string;
  receiptDate: string;
  vendor: string | null;
  totalCents: number;
  vatCents: number | null;
  currency: string;
  category: string;
  paymentMethod: string;
  projectId: string | null;
  status: string;
  hasImage: boolean;
  capturedAt: string;
}

export default withMySession(async (req, res, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const rows = await listReceiptsForStaff(session.staffId);
    const items: ReceiptListItem[] = rows.map((r) => ({
      id: r.id,
      receiptDate: r.receipt_date,
      vendor: r.vendor,
      totalCents: Number(r.total_cents),
      vatCents: r.vat_cents !== null ? Number(r.vat_cents) : null,
      currency: r.currency,
      category: r.category,
      paymentMethod: r.payment_method,
      projectId: r.project_id,
      status: r.status,
      hasImage: r.image_url.length > 0,
      capturedAt: r.captured_at,
    }));
    return apiResponse.success(res, { items });
  } catch (err) {
    log.error('[my/receipts] list failed', { err, staffId: session.staffId });
    return apiResponse.internalError(res, 'Failed to load receipts');
  }
});
