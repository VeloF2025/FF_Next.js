/**
 * PATCH /api/my/receipts/[id]/edit
 *
 * Edit-while-submitted. Returns 409 if the row has moved past
 * 'submitted' (finance approved/rejected/reconciled) — at that point
 * the staff must work with finance to amend.
 *
 * Per Hein's plan answer: "Editable until 'approved'. Any field can
 * be corrected while status='submitted'. Once finance approves, the
 * row locks."
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { isValidReceiptCategory, type ReceiptCategory } from '@/modules/receipts/categories';
import {
  updateOwnSubmittedReceipt,
  findReceiptById,
  type PaymentMethod,
} from '@/modules/receipts/queries';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

interface PatchBody {
  receiptDate?: string;
  vendor?: string | null;
  totalCents?: number;
  vatCents?: number | null;
  category?: ReceiptCategory;
  description?: string | null;
  paymentMethod?: PaymentMethod;
  projectId?: string | null;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === 'company_card' || value === 'personal_reimbursement';
}

export default withMySession(async (req, res, session) => {
  if (req.method !== 'PATCH') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['PATCH']);
  }

  const { id } = req.query;
  if (typeof id !== 'string' || id.length === 0) {
    return apiResponse.badRequest(res, 'Missing receipt id');
  }

  const body = (req.body ?? {}) as PatchBody;

  if (body.receiptDate !== undefined && !isIsoDate(body.receiptDate)) {
    return apiResponse.badRequest(res, 'receiptDate must be YYYY-MM-DD');
  }
  if (body.totalCents !== undefined && (typeof body.totalCents !== 'number' || body.totalCents < 0)) {
    return apiResponse.badRequest(res, 'totalCents must be a non-negative number');
  }
  if (body.vatCents !== undefined && body.vatCents !== null) {
    if (typeof body.vatCents !== 'number' || body.vatCents < 0) {
      return apiResponse.badRequest(res, 'vatCents must be non-negative when provided');
    }
  }
  if (body.category !== undefined && !isValidReceiptCategory(body.category)) {
    return apiResponse.badRequest(res, 'category must be a known taxonomy value');
  }
  if (body.paymentMethod !== undefined && !isPaymentMethod(body.paymentMethod)) {
    return apiResponse.badRequest(res, 'paymentMethod must be company_card | personal_reimbursement');
  }
  if (body.projectId !== undefined && body.projectId !== null && !isUuid(body.projectId)) {
    return apiResponse.badRequest(res, 'projectId must be a UUID when provided');
  }

  try {
    const updated = await updateOwnSubmittedReceipt({
      id,
      staffIdScope: session.staffId,
      receiptDate: body.receiptDate,
      vendor: body.vendor,
      totalCents: body.totalCents,
      vatCents: body.vatCents,
      category: body.category,
      description: body.description,
      paymentMethod: body.paymentMethod,
      projectId: body.projectId,
    });

    if (!updated) {
      // Either the row doesn't exist for this staff, OR it's no longer
      // submitted. Disambiguate so the client can explain to the user.
      const existing = await findReceiptById(id, session.staffId);
      if (!existing) {
        return apiResponse.notFound(res, 'Receipt', id);
      }
      return apiResponse.error(
        res,
        'CONFLICT' as never,
        `Receipt is no longer editable (status=${existing.status})`
      );
    }

    return apiResponse.success(res, {
      id: updated.id,
      receiptDate: updated.receipt_date,
      vendor: updated.vendor,
      totalCents: Number(updated.total_cents),
      category: updated.category,
      paymentMethod: updated.payment_method,
    });
  } catch (err) {
    log.error('[my/receipts/edit] failed', { err, staffId: session.staffId, receiptId: id });
    return apiResponse.internalError(res, 'Failed to edit receipt');
  }
});
