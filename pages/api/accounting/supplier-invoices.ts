/**
 * Supplier Invoices API
 * GET  /api/accounting/supplier-invoices - List invoices (with filters)
 * POST /api/accounting/supplier-invoices - Create draft invoice
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  getSupplierInvoices,
  createSupplierInvoice,
} from '@/modules/accounting/services/supplierInvoiceService';
import type { SupplierInvoiceStatus } from '@/modules/accounting/types/ap.types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { status, supplier_id, match_status, limit, offset } = req.query;
      const result = await getSupplierInvoices({
        status: status as SupplierInvoiceStatus | undefined,
        supplierId: supplier_id ? Number(supplier_id) : undefined,
        matchStatus: match_status as 'unmatched' | 'po_matched' | 'grn_matched' | 'fully_matched' | undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
      return apiResponse.success(res, result);
    } catch (err) {
      log.error('Failed to get supplier invoices', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, 'Failed to get supplier invoices');
    }
  }

  if (req.method === 'POST') {
    try {
      const { invoiceNumber, supplierId, purchaseOrderId, grnId, invoiceDate,
        dueDate, taxRate, paymentTerms, reference, projectId, costCenterId,
        notes, items } = req.body;

      if (!invoiceNumber || !supplierId || !invoiceDate || !items || !Array.isArray(items) || items.length === 0) {
        return apiResponse.badRequest(res, 'invoiceNumber, supplierId, invoiceDate, and items are required');
      }

      const userId = (req as unknown as { user?: { id: string } }).user?.id;
      if (!userId) return apiResponse.unauthorized(res, 'Unauthorized');

      const invoice = await createSupplierInvoice({
        invoiceNumber, supplierId: String(supplierId), purchaseOrderId, grnId,
        invoiceDate, dueDate, taxRate: taxRate ? Number(taxRate) : undefined,
        paymentTerms, reference, projectId, costCenterId, notes, items,
      }, userId);

      return apiResponse.created(res, invoice);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create supplier invoice';
      log.error('Failed to create supplier invoice', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, message);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(withErrorHandler(handler));
