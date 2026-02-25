/**
 * Customer Statements API
 * GET /api/accounting/customer-statements - Customer balances summary
 * Sage equivalent: Customers > Reports > Statements
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = createLoggedSql(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const customers = await sql`
      SELECT
        ci.client_id,
        c.company_name as client_name,
        SUM(ci.total_amount::numeric) as total_invoiced,
        SUM(ci.amount_paid::numeric) as total_paid,
        SUM(ci.total_amount::numeric) - SUM(ci.amount_paid::numeric) as balance,
        MAX(ci.paid_at) as last_payment_date,
        COUNT(*)::int as invoice_count
      FROM customer_invoices ci
      LEFT JOIN clients c ON c.id = ci.client_id
      WHERE ci.status != 'cancelled'
      GROUP BY ci.client_id, c.company_name
      HAVING SUM(ci.total_amount::numeric) > 0
      ORDER BY SUM(ci.total_amount::numeric) - SUM(ci.amount_paid::numeric) DESC
    `;

    return apiResponse.success(res, {
      customers: customers.map(c => ({
        ...c,
        total_invoiced: Number(c.total_invoiced),
        total_paid: Number(c.total_paid),
        balance: Number(c.balance),
        invoice_count: Number(c.invoice_count),
      })),
    });
  } catch (err) {
    log.error('Failed to fetch customer statements', { error: err, module: 'accounting' });
    return apiResponse.databaseError(res, err, 'Failed to fetch customer statements');
  }
}

export default withAuth(withErrorHandler(handler));
