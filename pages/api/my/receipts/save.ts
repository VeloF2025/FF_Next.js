/**
 * POST /api/my/receipts/save
 *
 * After /extract returns, the client lets the user review/edit the
 * extracted fields and pick category + payment method + (optional)
 * project. This endpoint accepts the JSON body and inserts the row.
 *
 * Auto-fills vehicle_assignment_id when staff has an active assignment
 * (per the plan: "vehicle auto-tagged when assigned, no friction").
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { findActiveVehicleAssignment } from '@/modules/attendance/portal/clockUtils';
import {
  isValidReceiptCategory,
  type ReceiptCategory,
} from '@/modules/receipts/categories';
import { insertReceipt, type PaymentMethod } from '@/modules/receipts/queries';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

interface SaveBody {
  extractionId?: string;
  imageUrl?: string;
  imageMime?: string;
  receiptDate?: string;
  vendor?: string | null;
  totalCents?: number;
  vatCents?: number | null;
  category?: ReceiptCategory;
  description?: string | null;
  paymentMethod?: PaymentMethod;
  projectId?: string | null;
  capturedLat?: number | null;
  capturedLon?: number | null;
  ocrRaw?: Record<string, unknown> | null;
  ocrCategoryGuess?: string | null;
  ocrConfidence?: number | null;
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
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const body = (req.body ?? {}) as SaveBody;

  if (!isUuid(body.extractionId)) {
    return apiResponse.badRequest(res, 'extractionId must be a UUID returned from /extract');
  }
  if (typeof body.imageUrl !== 'string' || !body.imageUrl.trim()) {
    return apiResponse.badRequest(res, 'imageUrl is required');
  }
  if (typeof body.imageMime !== 'string' || !body.imageMime.trim()) {
    return apiResponse.badRequest(res, 'imageMime is required');
  }
  if (!isIsoDate(body.receiptDate)) {
    return apiResponse.badRequest(res, 'receiptDate must be YYYY-MM-DD');
  }
  if (typeof body.totalCents !== 'number' || !Number.isFinite(body.totalCents) || body.totalCents < 0) {
    return apiResponse.badRequest(res, 'totalCents must be a non-negative integer');
  }
  if (!isValidReceiptCategory(body.category)) {
    return apiResponse.badRequest(res, 'category must be a known taxonomy value');
  }
  if (!isPaymentMethod(body.paymentMethod)) {
    return apiResponse.badRequest(res, 'paymentMethod must be company_card | personal_reimbursement');
  }
  if (body.vatCents !== undefined && body.vatCents !== null) {
    if (typeof body.vatCents !== 'number' || !Number.isFinite(body.vatCents) || body.vatCents < 0) {
      return apiResponse.badRequest(res, 'vatCents must be non-negative when provided');
    }
  }
  if (body.projectId !== undefined && body.projectId !== null && !isUuid(body.projectId)) {
    return apiResponse.badRequest(res, 'projectId must be a UUID when provided');
  }

  // Auto-fill vehicle assignment if staff currently has one active.
  let vehicleAssignmentId: string | null = null;
  try {
    const assignment = await findActiveVehicleAssignment(session.staffId);
    if (assignment) vehicleAssignmentId = assignment.id;
  } catch (err) {
    // Vehicle lookup is best-effort. Don't block the receipt save on it.
    log.warn('[my/receipts/save] vehicle assignment lookup failed', { err, staffId: session.staffId });
  }

  try {
    const row = await insertReceipt({
      id: body.extractionId,
      staffId: session.staffId,
      receiptDate: body.receiptDate,
      vendor: body.vendor ?? null,
      totalCents: Math.round(body.totalCents),
      vatCents: body.vatCents ?? null,
      category: body.category,
      description: body.description?.trim() || null,
      paymentMethod: body.paymentMethod,
      projectId: body.projectId ?? null,
      vehicleAssignmentId,
      imageUrl: body.imageUrl,
      imageMime: body.imageMime,
      capturedLat: typeof body.capturedLat === 'number' ? body.capturedLat : null,
      capturedLon: typeof body.capturedLon === 'number' ? body.capturedLon : null,
      ocrRaw: body.ocrRaw ?? null,
      ocrCategoryGuess: body.ocrCategoryGuess ?? null,
      ocrConfidence: body.ocrConfidence ?? null,
    });

    return apiResponse.success(res, {
      id: row.id,
      receiptDate: row.receipt_date,
      vendor: row.vendor,
      totalCents: Number(row.total_cents),
      category: row.category,
      paymentMethod: row.payment_method,
    });
  } catch (err) {
    log.error('[my/receipts/save] insert failed', { err, staffId: session.staffId, extractionId: body.extractionId });
    return apiResponse.internalError(res, 'Failed to save receipt');
  }
});
