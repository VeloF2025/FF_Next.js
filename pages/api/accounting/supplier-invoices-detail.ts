/**
 * Supplier Invoice Detail API
 * GET /api/accounting/supplier-invoices-detail?id=UUID - Get invoice with items
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getSupplierInvoiceById } from '@/modules/accounting/services/supplierInvoiceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const id = req.query.id as string;
    if (!id) return apiResponse.badRequest(res, 'id query parameter is required');

    const invoice = await getSupplierInvoiceById(id);
    if (!invoice) return apiResponse.notFound(res, 'Supplier invoice', id);

    return apiResponse.success(res, invoice);
  } catch (err) {
    log.error('Failed to get supplier invoice detail', { error: err }, 'accounting-api');
    return apiResponse.badRequest(res, 'Failed to get supplier invoice');
  }
}

export default withAuth(withErrorHandler(handler));
