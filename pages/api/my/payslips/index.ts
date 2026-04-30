/**
 * GET /api/my/payslips — list active payslips for the signed-in staff,
 * latest period first.
 *
 * PRD-040 Phase 3 / PR2. Session-gated; staff sees only their own rows
 * (queries.ts enforces the staff_id scope). archived_at IS NULL filter
 * is applied in the helper, so payslips that have aged out per the
 * 5-year retention policy are hidden from this view.
 */

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { listPayslipsForStaff } from '@/modules/payslips/queries';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

export interface PayslipListItem {
  id: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  hasPdf: boolean;
  importedAt: string;
}

export default withMySession(async (req, res, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const rows = await listPayslipsForStaff(session.staffId);
    const items: PayslipListItem[] = rows.map((r) => ({
      id: r.id,
      payPeriodStart: r.pay_period_start,
      payPeriodEnd: r.pay_period_end,
      grossCents: Number(r.gross_cents),
      deductionsCents: Number(r.deductions_cents),
      netCents: Number(r.net_cents),
      hasPdf: r.pdf_url !== null,
      importedAt: r.imported_at,
    }));
    return apiResponse.success(res, { items });
  } catch (error) {
    log.error('[my/payslips] list failed', { error, staffId: session.staffId });
    return apiResponse.internalError(res, 'Failed to load payslips');
  }
});
