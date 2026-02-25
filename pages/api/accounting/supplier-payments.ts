/**
 * Supplier Payments API
 * GET  /api/accounting/supplier-payments - List payments
 * POST /api/accounting/supplier-payments - Create payment with allocations
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  getSupplierPayments,
  createSupplierPayment,
} from '@/modules/accounting/services/supplierPaymentService';
import type { PaymentStatus } from '@/modules/accounting/types/ap.types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { status, supplier_id, limit, offset } = req.query;
      const result = await getSupplierPayments({
        status: status as PaymentStatus | undefined,
        supplierId: supplier_id ? Number(supplier_id) : undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
      return apiResponse.success(res, result);
    } catch (err) {
      log.error('Failed to get supplier payments', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, 'Failed to get supplier payments');
    }
  }

  if (req.method === 'POST') {
    try {
      const { supplierId, paymentDate, totalAmount, paymentMethod,
        bankAccountId, reference, description, allocations } = req.body;

      if (!supplierId || !paymentDate || !totalAmount || !allocations || !Array.isArray(allocations)) {
        return apiResponse.badRequest(res, 'supplierId, paymentDate, totalAmount, and allocations are required');
      }

      const userId = req.body.userId || (req as unknown as { user?: { id: string } }).user?.id;
      if (!userId) return apiResponse.badRequest(res, 'userId is required');

      const payment = await createSupplierPayment({
        supplierId: Number(supplierId),
        paymentDate, totalAmount: Number(totalAmount),
        paymentMethod, bankAccountId, reference, description,
        allocations,
      }, userId);

      return apiResponse.created(res, payment);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create payment';
      log.error('Failed to create supplier payment', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, message);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(withErrorHandler(handler));
